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
import { showPill, showLoggedToast, showNoticeToast } from './overlay';
import { installSuggestButtons, aiConfigured } from './suggest';
import { extractJobContext } from './job-context';
import { installSubmitWatch, maybeLogPostNavigation } from './submit-watch';

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
  void maybeAutoLogOnLoad();
  log.debug('content script loaded on', location.href);
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

  const actions: FillAction[] = [];
  for (const field of fields) {
    const value = valueForField(profile, field.kind);
    // Virtualised dropdowns need the async click-popup-click flow; rest are sync.
    if (field.widget === 'virtualizedDropdown') {
      // eslint-disable-next-line no-await-in-loop -- dropdowns are sequential by design
      actions.push(await fillVirtualizedDropdown(field, value));
    } else {
      actions.push(fillField(field, value, { forceOverwrite }));
    }
  }

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

  // Fire-and-forget the pill; never block the response on it.
  try {
    showPill({
      filled,
      skipped,
      failed,
      adapterId: adapter.id,
      adapterName: adapter.name,
      resume: resumeStatus,
    });
  } catch (err) {
    log.warn('overlay pill failed', err);
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
