/**
 * Content-script entry point. Loaded via manifest matches (curated ATS list)
 * and re-injected on demand with `allFrames: true` when the user clicks Fill.
 * A window-level guard short-circuits the second pass so the onMessage listener
 * registers once — otherwise we'd respond to every message twice.
 */

import { log } from '@/lib/logger';
import { isRequestMessage, type FillActionWire } from '@/types/messages';
import { pickAdapter } from './detector';
import { fillField, fillVirtualizedDropdown, type FillAction } from './filler';
import { valueForField } from './mapping';
import { getProfile, getSettings, getResume } from '@/profile/store';
import { resumeRecordToFile } from '@/profile/resume';
import { showLoggedToast, showNoticeToast } from './overlay';
import {
  showFillTrigger,
  setFillTriggerFilling,
  setFillTriggerProgress,
  showFillTriggerDone,
  type TriggerStats,
} from './affordance';
import { installSuggestButtons, aiConfigured } from './suggest';
import { extractJobContext } from './job-context';
import { installSubmitWatch, maybeLogPostNavigation } from './submit-watch';
import {
  FILL_ANIM,
  applyFlash,
  beginRun,
  clearFlashes,
  delay,
  isCurrentRun,
  prefersReducedMotion,
} from './fill-anim';

/**
 * In an embedded ATS iframe (e.g. job-boards.greenhouse.io inside
 * spotandtango.com) we can't render a viewport-fixed pill — position:fixed
 * anchors to the iframe's own viewport. Instead we postMessage the parent
 * page where parent-stub.ts has installed a listener that mounts the pill
 * on the real viewport. Pill state messages flow iframe → parent; click
 * events flow parent → iframe (`autofilltool:fill-request`) and trigger
 * the same runFill that the local pill click would.
 */
const IS_IFRAME = (() => {
  try {
    return window.top !== window.self;
  } catch {
    return true; // cross-origin top can throw — treat as iframe.
  }
})();

const PARENT_RETRY_MS = 500;
const PARENT_MAX_RETRIES = 5;
let parentAckReceived = false;
/** Pending click handler the parent will trigger via fill-request postMessage. */
let pendingParentFillHandler: (() => void) | null = null;

declare global {
  interface Window {
    __autofilltool_loaded__?: boolean;
  }
}

// Skip re-init on re-injection; the first load's listener stays live.
if (window.__autofilltool_loaded__) {
  log.debug('content script re-injected; skipping second init on', location.href);
} else {
  window.__autofilltool_loaded__ = true;
  initialize();
  if (IS_IFRAME) installParentMessageListener();
  void maybeAutoLogOnLoad();
  void maybeShowTrigger();
  log.debug('content script loaded on', location.href);
}

/**
 * Proactively offer the in-page "Fill this page" trigger when the page looks
 * like a job application. Retries a couple of times because ATS forms often
 * render after first paint (SPA hydration); stops as soon as it shows or the
 * page clearly has no form.
 */
async function maybeShowTrigger(): Promise<void> {
  const delays = [0, 800, 2000];
  for (const delay of delays) {
    if (delay) await sleep(delay);
    try {
      const url = new URL(location.href);
      const adapter = pickAdapter(url, document);
      const fields = adapter.detectFields(document);
      if (fields.length > 0) {
        if (IS_IFRAME) {
          notifyParentOfFields(fields.length, () => void triggerInPageFill());
        } else {
          showFillTrigger({
            detected: fields.length,
            onFill: () => void triggerInPageFill(),
          });
        }
        return;
      }
    } catch (err) {
      log.warn('trigger detection failed', err);
    }
  }
}

/** In-page button handler: show the filling state, then run the real fill. */
async function triggerInPageFill(): Promise<void> {
  pillFilling();
  try {
    await runFill();
  } catch (err) {
    log.warn('in-page fill failed', err);
  }
}

/* ----------------------------------------- parent-page relay (iframe only) */

/** Send `iframe-pill-needed` to the parent page with bounded retries until ack. */
function notifyParentOfFields(detected: number, onFill: () => void): void {
  pendingParentFillHandler = onFill;
  parentAckReceived = false;
  let attempts = 0;
  const send = (): void => {
    if (parentAckReceived) return;
    if (attempts++ >= PARENT_MAX_RETRIES) return;
    try {
      window.parent.postMessage(
        { type: 'autofilltool:iframe-pill-needed', detected },
        '*',
      );
    } catch (err) {
      log.warn('iframe→parent postMessage failed', err);
    }
    setTimeout(send, PARENT_RETRY_MS);
  };
  send();
}

/** Listen for ack + fill-request from the parent page. */
function installParentMessageListener(): void {
  window.addEventListener('message', (e) => {
    if (e.source !== window.parent) return;
    if (typeof e.data !== 'object' || e.data === null) return;
    const data = e.data as { type?: unknown };
    if (typeof data.type !== 'string') return;
    if (data.type === 'autofilltool:ack') {
      parentAckReceived = true;
      return;
    }
    if (data.type === 'autofilltool:fill-request') {
      pendingParentFillHandler?.();
      return;
    }
  });
}

/** Pill-state setters that route to either the local affordance or the parent. */
function pillFilling(): void {
  if (IS_IFRAME) postToParent({ type: 'autofilltool:fill-started' });
  else setFillTriggerFilling();
}

function pillProgress(done: number, total: number): void {
  if (IS_IFRAME) postToParent({ type: 'autofilltool:fill-progress', done, total });
  else setFillTriggerProgress(done, total);
}

function pillDone(stats: TriggerStats): void {
  if (IS_IFRAME) postToParent({ type: 'autofilltool:fill-complete', ...stats });
  else showFillTriggerDone(stats);
}

function postToParent(msg: Record<string, unknown>): void {
  try {
    window.parent.postMessage(msg, '*');
  } catch (err) {
    log.warn('iframe→parent postMessage failed', err);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * On load, handle the full-navigation submit case: if auto-log is on and this
 * looks like a confirmation page following a recent fill, log it. No-op
 * otherwise. Cheap: bails right after the settings check when disabled.
 */
async function maybeAutoLogOnLoad(): Promise<void> {
  try {
    const settings = await getSettings();
    if (!settings.tracking.autoLogOnSubmit) return;
    const url = new URL(location.href);
    const adapter = pickAdapter(url, document);
    await maybeLogPostNavigation(adapter, document, url, showLoggedToast);
  } catch (err) {
    log.warn('auto-log on load failed', err);
  }
}

function initialize(): void {
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!isRequestMessage(msg)) return false;

    if (msg.type === 'PING') {
      // Background uses this to detect whether we're already injected.
      sendResponse({ ok: true, value: { pong: true, at: new Date().toISOString() } });
      return true;
    }

    if (msg.type === 'FILL_PAGE') {
      void runFill(msg.options?.forceOverwrite).then(
        (result) => sendResponse(result),
        (err: unknown) => {
          const error = err instanceof Error ? err.message : String(err);
          sendResponse({ ok: false, error });
        },
      );
      return true; // we'll respond async
    }

    if (msg.type === 'SHOW_NOTICE') {
      // Background sends this to the top frame (e.g. "no form detected").
      try {
        showNoticeToast(msg.text);
        sendResponse({ ok: true, value: { shown: true } });
      } catch (err) {
        sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
      }
      return true;
    }

    return false;
  });
}

async function runFill(forceFromMsg?: boolean) {
  const url = new URL(location.href);
  const adapter = pickAdapter(url, document);
  const fields = adapter.detectFields(document);

  const [profile, settings, resume] = await Promise.all([
    getProfile(),
    getSettings(),
    getResume(),
  ]);
  const forceOverwrite = forceFromMsg ?? settings.forceOverwrite;
  const animate = settings.ui.animateFill && !prefersReducedMotion();
  const runId = animate ? beginRun() : 0;

  if (animate) {
    clearFlashes();
    pillFilling();
    pillProgress(0, fields.length);
  }

  const actions: FillAction[] = [];
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i]!;
    const value = valueForField(profile, field.kind);
    let action: FillAction;
    // Virtualised dropdowns need the async click-popup-click flow; rest are sync.
    if (field.widget === 'virtualizedDropdown') {
      // eslint-disable-next-line no-await-in-loop -- dropdowns are sequential by design
      action = await fillVirtualizedDropdown(field, value, { suppressFlash: animate });
    } else {
      action = fillField(field, value, { forceOverwrite, suppressFlash: animate });
    }
    actions.push(action);

    if (animate) {
      if (!isCurrentRun(runId)) break; // superseded by a new fill
      if (action.status === 'filled' && field.el instanceof HTMLElement) {
        applyFlash(field.el);
      }
      pillProgress(i + 1, fields.length);
      if (i < fields.length - 1) {
        // eslint-disable-next-line no-await-in-loop -- per-field stagger is the feature
        await delay(FILL_ANIM.STAGGER_MS);
      }
    }
  }

  if (animate) await delay(FILL_ANIM.SETTLE_MS);

  // Resume attaches after text fields so visibility-toggling listeners settle.
  let resumeStatus: 'attached' | 'skipped' | 'notFound' | 'noResume' | 'noHook' =
    'noResume';
  if (resume) {
    if (adapter.fillResume) {
      try {
        const file = resumeRecordToFile(resume);
        const ok = await adapter.fillResume(file, document);
        resumeStatus = ok ? 'attached' : 'notFound';
        actions.push({
          label: 'Resume',
          kind: 'resume',
          status: ok ? 'filled' : 'skipped',
          note: ok ? `attached ${resume.filename}` : 'no resume input found on page',
        });
      } catch (err) {
        resumeStatus = 'notFound';
        actions.push({
          label: 'Resume',
          kind: 'resume',
          status: 'error',
          note: err instanceof Error ? err.message : String(err),
        });
      }
    } else {
      resumeStatus = 'noHook';
    }
  }

  const filled = actions.filter((a) => a.status === 'filled').length;
  const skipped = actions.filter((a) => a.status === 'skipped').length;
  const failed = actions.filter(
    (a) => a.status === 'error' || a.status === 'unsupported',
  ).length;

  const wire: FillActionWire[] = actions.map((a) => {
    const base: FillActionWire = { label: a.label, kind: a.kind, status: a.status };
    return a.note ? { ...base, note: a.note } : base;
  });

  const ctx = extractJobContext(document, url);

  // Inject ✨ Suggest buttons next to open-ended textareas (idempotent). Pull
  // jobDescription from the adapter for prompt context, guarded so a crashed
  // Readability run doesn't kill suggest setup.
  try {
    try {
      ctx.jobDescription = adapter.getJobDescription(document) || '';
    } catch (err) {
      log.warn('getJobDescription failed', err);
    }
    installSuggestButtons(fields, ctx, { aiConfigured: aiConfigured(settings) });
  } catch (err) {
    log.warn('suggest-button injection failed', err);
  }

  // Opt-in: watch for the user's real submit and auto-log it to history/sheet.
  if (settings.tracking.autoLogOnSubmit) {
    try {
      installSubmitWatch({ adapter, ctx, onLogged: showLoggedToast });
    } catch (err) {
      log.warn('submit-watch install failed', err);
    }
  }

  // Open-ended fields that still want a human/AI answer — surfaced as the
  // "✨ N to Suggest" chip, only when an AI provider is configured.
  const suggestCount = aiConfigured(settings)
    ? fields.filter(
        (f) =>
          (f.kind === 'openEnded' || f.kind === 'coverLetter') &&
          f.el instanceof HTMLTextAreaElement,
      ).length
    : 0;

  // Drive the unified in-page affordance into its results state — in an
  // iframe this becomes a postMessage to the parent-stub. Never block the
  // response on it.
  try {
    pillDone({
      filled,
      skipped,
      failed,
      suggest: suggestCount,
      adapterId: adapter.id,
      adapterName: adapter.name,
      resume: resumeStatus,
    });
  } catch (err) {
    log.warn('overlay affordance failed', err);
  }

  log.debug(
    `fill via ${adapter.id}: ${filled} filled / ${skipped} skipped / ${failed} failed / resume=${resumeStatus}`,
  );

  return {
    ok: true as const,
    value: {
      adapterId: adapter.id,
      filled,
      skipped,
      failed,
      total: actions.length,
      fieldsDetected: fields.length,
      actions: wire,
    },
  };
}
