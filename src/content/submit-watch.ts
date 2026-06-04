/**
 * Auto-log on real submit. After a fill, watch passively for the user's own
 * submission to succeed, then fire one LOG_SUBMISSION — no pill click needed.
 * Observe-only: we never click, submit, or call preventDefault. Two cases:
 *   - In-page (SPA) confirmation: a MutationObserver + history hook catch the
 *     "thank you" view rendering after the user clicks the page's own Submit.
 *   - Full navigation (e.g. Greenhouse): a chrome.storage.session breadcrumb
 *     written at fill time lets the reloaded content script recognise the
 *     confirmation page and log against the original posting metadata.
 * Installed automatically whenever a tracking webhook URL is configured;
 * guarded to fire once.
 */

import type { PlatformAdapter } from '@/adapters/types';
import type { JobContext } from './job-context';
import { AdapterIdSchema, type AdapterId } from '@/profile/schema';
import { hasSubmissionConfirmText } from '@/adapters/_shared';
import { looksLikeSubmit } from './filler';
import { sendToBackground } from '@/lib/messaging';
import { log } from '@/lib/logger';

const BREADCRUMB_KEY = 'autofilltool:lastFill';
const WATCH_MS = 10 * 60 * 1000; // stop watching / honor a breadcrumb for 10 min

type Breadcrumb = {
  jobUrl: string;
  company: string;
  role: string;
  adapterId: string;
  at: number;
};

export type LoggedRecord = {
  company: string;
  role: string;
  jobUrl: string;
  posted: boolean;
};

type WatchArgs = {
  adapter: PlatformAdapter;
  ctx: JobContext;
  /** Called after a successful auto-log so the UI can show a toast. */
  onLogged?: (record: LoggedRecord) => void;
};

// Module-level singletons; reset naturally on each fresh content-script load.
let installed = false;
let fired = false;

/* --------------------------------------------------------- confirmation */

/** True when the page currently shows a post-submit confirmation. Never throws. */
export function isSubmissionConfirmed(
  adapter: PlatformAdapter,
  doc: Document,
  url: URL,
): boolean {
  try {
    if (adapter.detectSubmissionConfirmed) {
      return adapter.detectSubmissionConfirmed(doc, url);
    }
  } catch (err) {
    log.warn('detectSubmissionConfirmed threw', err);
  }
  return sharedConfirmed(doc);
}

/** Adapter-agnostic fallback: a confirmation phrase with no open submit control. */
export function sharedConfirmed(doc: Document): boolean {
  if (!hasSubmissionConfirmText(doc)) return false;
  return !hasVisibleSubmit(doc);
}

function hasVisibleSubmit(doc: Document): boolean {
  const controls = doc.querySelectorAll<HTMLElement>(
    'button, input[type="submit"], [role="button"]',
  );
  for (const el of Array.from(controls)) {
    if (looksLikeSubmit(el) && isVisible(el)) return true;
  }
  return false;
}

function isVisible(el: HTMLElement): boolean {
  if (!el.isConnected) return false;
  const view = el.ownerDocument.defaultView;
  const style = view?.getComputedStyle(el);
  if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
  const rect = el.getBoundingClientRect();
  // jsdom reports 0×0 for everything; treat that as "present" there, visible elsewhere.
  if (view && typeof view.getComputedStyle === 'function' && rect.width === 0 && rect.height === 0) {
    return style ? style.display !== 'none' && style.visibility !== 'hidden' : true;
  }
  return true;
}

/* ----------------------------------------------------------- logging */

async function doLog(
  source: string,
  meta: { adapterId: AdapterId; company: string; role: string; jobUrl: string },
  onLogged?: (record: LoggedRecord) => void,
): Promise<void> {
  if (fired) return;
  fired = true;
  await clearBreadcrumb();
  try {
    const res = await sendToBackground({
      type: 'LOG_SUBMISSION',
      record: {
        source: meta.adapterId,
        status: 'submitted',
        company: meta.company,
        role: meta.role,
        jobUrl: meta.jobUrl,
        note: `auto-logged on submit (${source})`,
      },
    });
    if (res.ok) {
      log.debug('auto-logged submission', res.value);
      onLogged?.({
        company: meta.company,
        role: meta.role,
        jobUrl: meta.jobUrl,
        posted: res.value.posted,
      });
    } else {
      log.warn('auto-log failed', res.error);
    }
  } catch (err) {
    log.warn('auto-log send threw', err);
  }
}

/* ----------------------------------------------------------- breadcrumb */

async function writeBreadcrumb(args: WatchArgs): Promise<void> {
  try {
    const crumb: Breadcrumb = {
      jobUrl: args.ctx.jobUrl || location.href,
      company: args.ctx.company,
      role: args.ctx.role,
      adapterId: args.adapter.id,
      at: Date.now(),
    };
    await chrome.storage.session.set({ [BREADCRUMB_KEY]: crumb });
  } catch (err) {
    log.warn('breadcrumb write failed', err);
  }
}

async function clearBreadcrumb(): Promise<void> {
  try {
    await chrome.storage.session.remove(BREADCRUMB_KEY);
  } catch {
    /* best-effort */
  }
}

async function readBreadcrumb(): Promise<Breadcrumb | null> {
  try {
    const got = await chrome.storage.session.get(BREADCRUMB_KEY);
    const v = got[BREADCRUMB_KEY] as Breadcrumb | undefined;
    if (!v || typeof v !== 'object' || typeof v.at !== 'number') return null;
    if (Date.now() - v.at > WATCH_MS) return null;
    return v;
  } catch {
    return null;
  }
}

/* ----------------------------------------------------------- watchers */

/**
 * Arm the in-page watcher after a fill. Records a breadcrumb (for the full-nav
 * case), then fires once when a real submit attempt is followed by a
 * confirmation view. Idempotent across repeated fills on the same page.
 */
export function installSubmitWatch(args: WatchArgs): void {
  if (installed) return;
  installed = true;

  void writeBreadcrumb(args);

  let sawAttempt = false;

  // Passive: only records that the user tried to submit; never intervenes.
  const onAttempt = (e: Event): void => {
    if (e.type === 'submit') {
      sawAttempt = true;
      return;
    }
    const t = e.target;
    if (t instanceof Element) {
      const btn = t.closest<HTMLElement>('button, input[type="submit"], [role="button"]');
      if (btn && looksLikeSubmit(btn)) sawAttempt = true;
    }
  };

  let timer = 0;
  const teardown = (): void => {
    if (timer) clearTimeout(timer);
    document.removeEventListener('submit', onAttempt, true);
    document.removeEventListener('click', onAttempt, true);
    observer.disconnect();
    window.removeEventListener('popstate', onNav);
    history.pushState = origPush;
    history.replaceState = origReplace;
  };

  const check = (): void => {
    if (fired || !sawAttempt) return;
    if (!isSubmissionConfirmed(args.adapter, document, new URL(location.href))) return;
    void doLog(
      'in-page',
      {
        adapterId: args.adapter.id,
        company: args.ctx.company,
        role: args.ctx.role,
        jobUrl: args.ctx.jobUrl || location.href,
      },
      args.onLogged,
    ).finally(teardown);
  };

  document.addEventListener('submit', onAttempt, true);
  document.addEventListener('click', onAttempt, true);

  const observer = new MutationObserver(() => check());
  observer.observe(document.documentElement, { childList: true, subtree: true });

  // SPA route changes (Lever/Ashby/Workday) that swap views without a reload.
  const onNav = (): void => check();
  const origPush = history.pushState;
  const origReplace = history.replaceState;
  const patchedPush: History['pushState'] = (...a) => {
    origPush.apply(history, a);
    onNav();
  };
  const patchedReplace: History['replaceState'] = (...a) => {
    origReplace.apply(history, a);
    onNav();
  };
  history.pushState = patchedPush;
  history.replaceState = patchedReplace;
  window.addEventListener('popstate', onNav);

  timer = window.setTimeout(teardown, WATCH_MS);
}

/**
 * Full-navigation case: when the content script loads on what looks like a
 * confirmation page and a recent same-origin breadcrumb exists, auto-log
 * against the original posting metadata. No-op without a breadcrumb.
 */
export async function maybeLogPostNavigation(
  adapter: PlatformAdapter,
  doc: Document,
  url: URL,
  onLogged?: (record: LoggedRecord) => void,
): Promise<void> {
  if (fired) return;
  const crumb = await readBreadcrumb();
  if (!crumb) return;
  if (!sameHost(crumb.jobUrl, url)) return;
  if (!isSubmissionConfirmed(adapter, doc, url)) return;
  const parsed = AdapterIdSchema.safeParse(crumb.adapterId);
  await doLog(
    'post-nav',
    {
      adapterId: parsed.success ? parsed.data : adapter.id,
      company: crumb.company,
      role: crumb.role,
      jobUrl: crumb.jobUrl,
    },
    onLogged,
  );
}

function sameHost(a: string, b: URL): boolean {
  try {
    return new URL(a).hostname === b.hostname;
  } catch {
    return false;
  }
}

/** Test-only: reset the module guards between cases. */
export function __resetSubmitWatchForTests(): void {
  installed = false;
  fired = false;
}
