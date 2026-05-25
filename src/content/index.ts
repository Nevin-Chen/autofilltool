/**
 * Content-script entry point. Loaded into pages matched by manifest's
 * content_scripts (the curated ATS list) and also injected on demand via
 * chrome.scripting from the popup when the user wants to fill an arbitrary
 * page.
 */

import { log } from '@/lib/logger';
import { isRequestMessage, type FillActionWire } from '@/types/messages';
import { pickAdapter } from './detector';
import { fillField, type FillAction } from './filler';
import { valueForField } from './mapping';
import { getProfile, getSettings } from '@/profile/store';
import { showToast } from './overlay';

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

async function runFill(forceFromMsg?: boolean) {
  const url = new URL(location.href);
  const adapter = pickAdapter(url, document);
  const fields = adapter.detectFields(document);

  const [profile, settings] = await Promise.all([getProfile(), getSettings()]);
  const forceOverwrite = forceFromMsg ?? settings.forceOverwrite;

  const actions: FillAction[] = [];
  for (const field of fields) {
    const value = valueForField(profile, field.kind);
    actions.push(fillField(field, value, { forceOverwrite }));
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

  // Fire-and-forget the in-page toast; never block the response on it.
  try {
    showToast({ filled, skipped, failed, adapterName: adapter.name });
  } catch (err) {
    log.warn('overlay toast failed', err);
  }

  log.debug(`fill via ${adapter.id}: ${filled} filled / ${skipped} skipped / ${failed} failed`);

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

log.debug('content script loaded on', location.href);
