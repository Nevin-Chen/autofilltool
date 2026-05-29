/**
 * Content-script entry point. Loaded into pages matched by manifest's
 * content_scripts (the curated ATS list) and also injected on demand via
 * chrome.scripting from the popup when the user wants to fill an arbitrary
 * page — including iframes embedded into a company's career page.
 *
 * Re-injection guard: when the user clicks Fill from the popup, the
 * background re-injects this bundle with `allFrames: true`. On a tab whose
 * top frame already loaded the script via the manifest matches, that
 * re-injection would otherwise register the runtime.onMessage listener a
 * second time and we'd respond to every message twice. A window-level
 * boolean short-circuits the rest of the module on the second pass; the
 * first listener registration is the one that stays live.
 */

import { log } from '@/lib/logger';
import { isRequestMessage, type FillActionWire } from '@/types/messages';
import { pickAdapter } from './detector';
import { fillField, fillVirtualizedDropdown, type FillAction } from './filler';
import { valueForField } from './mapping';
import { getProfile, getSettings, getResume } from '@/profile/store';
import { resumeRecordToFile } from '@/profile/resume';
import { showPill } from './overlay';
import { installSuggestButtons } from './suggest';
import { extractJobContext } from './job-context';

declare global {
  interface Window {
    __autofilltool_loaded__?: boolean;
  }
}

// Skip module-level side effects (listener registration) on re-injection.
// The first load wins — its listener stays live and receives FILL_PAGE.
if (window.__autofilltool_loaded__) {
  log.debug('content script re-injected; skipping second init on', location.href);
} else {
  window.__autofilltool_loaded__ = true;
  initialize();
  log.debug('content script loaded on', location.href);
}

function initialize(): void {
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!isRequestMessage(msg)) return false;

    if (msg.type === 'PING') {
      // Used by the background to detect whether we're already injected.
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
    // Virtualised dropdowns (Workday-style React comboboxes) need the
    // async click-popup-click flow; everything else uses the sync path.
    if (field.widget === 'virtualizedDropdown') {
      // eslint-disable-next-line no-await-in-loop -- dropdowns are sequential by design
      actions.push(await fillVirtualizedDropdown(field, value));
    } else {
      actions.push(fillField(field, value, { forceOverwrite }));
    }
  }

  // Resume attachment runs after text fields so any visibility-toggling
  // listeners on text fields have already settled. The pill summarises the
  // outcome as a separate "resume" line so the user knows whether it landed.
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

  // Inject ✨ Suggest buttons next to every open-ended textarea we detected.
  // Idempotent — re-running Fill won't double-attach. Settings.ai.provider
  // is checked in the background; even with no key the button shows a clear
  // "Open Options" status when clicked.
  //
  // jobDescription is pulled from the adapter so the AI prompt has the
  // actual posting text as context. Wrapped in its own try because a
  // crashed Readability run shouldn't kill the rest of suggest setup.
  try {
    const ctx = extractJobContext(document, url);
    try {
      ctx.jobDescription = adapter.getJobDescription(document) || '';
    } catch (err) {
      log.warn('getJobDescription failed', err);
    }
    installSuggestButtons(fields, ctx);
  } catch (err) {
    log.warn('suggest-button injection failed', err);
  }

  // Fire-and-forget the in-page pill; never block the response on it.
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
      actions: wire,
    },
  };
}
