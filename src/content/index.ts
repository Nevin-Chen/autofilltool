import { log } from '@/lib/logger';
import { isExtensionContextValid } from '@/lib/context';
import { isRequestMessage, type FillActionWire } from '@/types/messages';
import { pickAdapter } from './detector';
import {
  fillField,
  fillVirtualizedDropdown,
  isFileAlreadyAttached,
  type FillAction,
} from './filler';
import { valueForField } from './mapping';
import { getProfile, getSettings, getResume } from '@/profile/store';
import { resumeRecordToFile } from '@/profile/resume';
import { showLoggedToast, showNoticeToast } from './overlay';
import {
  showFillTrigger,
  removeFillTrigger,
  setFillTriggerFilling,
  setFillTriggerProgress,
  showFillTriggerDone,
  nextConnected,
  spotlight,
  type TriggerStats,
  type ReviewableField,
  type ReviewGroup,
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

const IS_IFRAME = (() => {
  try {
    return window.top !== window.self;
  } catch {
    return true;
  }
})();

const PARENT_RETRY_MS = 500;
const PARENT_MAX_RETRIES = 5;
let parentAckReceived = false;
let pendingParentFillHandler: (() => void) | null = null;

declare global {
  interface Window {
    __autofilltool_loaded__?: boolean;
  }
}

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

const TRIGGER_OBSERVE_MS = 30_000;
const TRIGGER_OBSERVE_DEBOUNCE_MS = 250;

async function maybeShowTrigger(): Promise<void> {
  const tryDetect = (): boolean => {
    try {
      const url = new URL(location.href);
      const adapter = pickAdapter(url, document);
      const fields = adapter.detectFields(document);
      if (fields.length === 0) return false;
      if (IS_IFRAME) {
        notifyParentOfFields(fields.length, () => void triggerInPageFill());
      } else {
        showFillTrigger({
          detected: fields.length,
          onFill: () => void triggerInPageFill(),
        });
      }
      return true;
    } catch (err) {
      log.warn('trigger detection failed', err);
      return false;
    }
  };

  for (const delay of [0, 800, 2000]) {
    if (delay) await sleep(delay);
    if (tryDetect()) return;
  }

  await observeForTrigger(tryDetect);
}

function observeForTrigger(tryDetect: () => boolean): Promise<void> {
  return new Promise((resolve) => {
    const body = document.body ?? document.documentElement;
    let timer: number | null = null;
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      observer.disconnect();
      if (timer !== null) clearTimeout(timer);
      clearTimeout(cap);
      resolve();
    };
    const observer = new MutationObserver(() => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        if (tryDetect()) finish();
      }, TRIGGER_OBSERVE_DEBOUNCE_MS) as unknown as number;
    });
    observer.observe(body, { childList: true, subtree: true });
    const cap = setTimeout(finish, TRIGGER_OBSERVE_MS);
  });
}

async function triggerInPageFill(): Promise<void> {
  if (!isExtensionContextValid()) {
    notifyInvalidContext();
    return;
  }
  pillFilling();
  try {
    await runFill();
  } catch (err) {
    if (!isExtensionContextValid()) {
      notifyInvalidContext();
      return;
    }
    log.warn('in-page fill failed', err);
  }
}

function notifyInvalidContext(): void {
  try {
    removeFillTrigger();
  } catch {
  }
  try {
    showNoticeToast('AutoFillTool was updated — refresh this page to continue.');
  } catch {
  }
}

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

let lastReviewItems: ReviewableField[] = [];
let iframeReviewState: { group: ReviewGroup; index: number } | null = null;
const REVIEW_GROUPS: ReadonlyArray<ReviewGroup> = ['filled', 'skipped', 'suggest'];

function installParentMessageListener(): void {
  window.addEventListener('message', (e) => {
    if (e.source !== window.parent) return;
    if (typeof e.data !== 'object' || e.data === null) return;
    const data = e.data as { type?: unknown; group?: unknown; dir?: unknown };
    if (typeof data.type !== 'string') return;
    if (data.type === 'autofilltool:ack') {
      parentAckReceived = true;
      return;
    }
    if (data.type === 'autofilltool:fill-request') {
      pendingParentFillHandler?.();
      return;
    }
    if (data.type === 'autofilltool:review-enter') {
      if (typeof data.group === 'string' && (REVIEW_GROUPS as ReadonlyArray<string>).includes(data.group)) {
        iframeEnterReview(data.group as ReviewGroup);
      }
      return;
    }
    if (data.type === 'autofilltool:review-step') {
      if (data.dir === 1 || data.dir === -1) iframeStepReview(data.dir);
      return;
    }
    if (data.type === 'autofilltool:review-exit') {
      iframeReviewState = null;
      return;
    }
  });
}

function iframeEnterReview(group: ReviewGroup): void {
  const items = lastReviewItems.filter((i) => i.group === group);
  const first = nextConnected(items, -1, 1);
  if (first === -1) {
    postToParent({ type: 'autofilltool:review-empty' });
    return;
  }
  iframeReviewState = { group, index: first };
  const item = items[first]!;
  spotlight(item.el);
  postToParent({
    type: 'autofilltool:review-state',
    group,
    index: first,
    total: items.length,
    label: item.label,
  });
}

function iframeStepReview(dir: 1 | -1): void {
  if (!iframeReviewState) return;
  const group = iframeReviewState.group;
  const items = lastReviewItems.filter((i) => i.group === group);
  const next = nextConnected(items, iframeReviewState.index, dir);
  if (next === -1) {
    iframeReviewState = null;
    postToParent({ type: 'autofilltool:review-empty' });
    return;
  }
  iframeReviewState.index = next;
  const item = items[next]!;
  spotlight(item.el);
  postToParent({
    type: 'autofilltool:review-state',
    group,
    index: next,
    total: items.length,
    label: item.label,
  });
}

function pillFilling(): void {
  if (IS_IFRAME) postToParent({ type: 'autofilltool:fill-started' });
  else setFillTriggerFilling();
}

function pillProgress(done: number, total: number): void {
  if (IS_IFRAME) postToParent({ type: 'autofilltool:fill-progress', done, total });
  else setFillTriggerProgress(done, total);
}

function pillDone(stats: TriggerStats, items: ReviewableField[]): void {
  if (IS_IFRAME) postToParent({ type: 'autofilltool:fill-complete', ...stats });
  else showFillTriggerDone(stats, items);
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

async function maybeAutoLogOnLoad(): Promise<void> {
  try {
    const settings = await getSettings();
    if (!settings.tracking.webhookUrl) return;
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
      return true;
    }

    if (msg.type === 'SHOW_NOTICE') {
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
  if (!isExtensionContextValid()) {
    notifyInvalidContext();
    return { ok: false as const, error: 'Extension context invalidated' };
  }
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
  const reviewItems: ReviewableField[] = [];
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i]!;
    const value = valueForField(profile, field.kind);
    let action: FillAction;
    if (field.widget === 'virtualizedDropdown') {
      action = await fillVirtualizedDropdown(field, value, { suppressFlash: animate });
    } else {
      action = fillField(field, value, { forceOverwrite, suppressFlash: animate });
    }
    actions.push(action);
    if (field.el instanceof HTMLElement) {
      if (action.status === 'filled') {
        reviewItems.push({ group: 'filled', label: action.label, el: field.el });
      } else if (action.status === 'skipped') {
        reviewItems.push({ group: 'skipped', label: action.label, el: field.el });
      }
    }

    if (animate) {
      if (!isCurrentRun(runId)) break;
      if (action.status === 'filled' && field.el instanceof HTMLElement) {
        applyFlash(field.el);
      }
      pillProgress(i + 1, fields.length);
      if (i < fields.length - 1) {
        await delay(FILL_ANIM.STAGGER_MS);
      }
    }
  }

  if (animate) await delay(FILL_ANIM.SETTLE_MS);

  let resumeStatus: 'attached' | 'skipped' | 'notFound' | 'noResume' | 'noHook' =
    'noResume';
  if (resume) {
    if (adapter.fillResume) {
      const file = resumeRecordToFile(resume);
      if (isFileAlreadyAttached(document, file)) {
        resumeStatus = 'skipped';
        actions.push({
          label: 'Resume',
          kind: 'resume',
          status: 'skipped',
          note: 'already attached',
        });
      } else {
        try {
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

  if (settings.tracking.webhookUrl) {
    try {
      installSubmitWatch({ adapter, ctx, onLogged: showLoggedToast });
    } catch (err) {
      log.warn('submit-watch install failed', err);
    }
  }

  const suggestFields = aiConfigured(settings)
    ? fields.filter(
        (f) =>
          (f.kind === 'openEnded' || f.kind === 'coverLetter') &&
          f.el instanceof HTMLTextAreaElement,
      )
    : [];
  const suggestCount = suggestFields.length;
  for (const f of suggestFields) {
    if (f.el instanceof HTMLElement) {
      reviewItems.push({ group: 'suggest', label: f.label, el: f.el });
    }
  }

  try {
    lastReviewItems = reviewItems;
    iframeReviewState = null;
    pillDone(
      {
        filled,
        skipped,
        failed,
        suggest: suggestCount,
        adapterId: adapter.id,
        adapterName: adapter.name,
        resume: resumeStatus,
        autoLogging: !!settings.tracking.webhookUrl,
      },
      reviewItems,
    );
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
