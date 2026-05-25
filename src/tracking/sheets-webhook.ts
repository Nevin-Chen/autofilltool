/**
 * Posts submission records to the user's webhook (typically a Google Apps
 * Script web app URL). Runs in the background service worker, never in a
 * content script — content scripts share the page's origin and would get
 * CORS-blocked.
 *
 * We POST as `text/plain` deliberately: Apps Script accepts it via
 * `e.postData.contents`, and `text/plain` is a "simple" request that avoids
 * the CORS preflight roundtrip. The response is opaque to us if the user
 * hasn't granted host permission, but we surface that as a clear error.
 *
 * Retries once on transient network errors. Validates the URL through zod
 * so an obviously bad config (http://, not a URL, etc.) fails fast and
 * loudly rather than silently dropping the log.
 */

import { z } from 'zod';
import type { SubmissionRecord } from '@/profile/schema';
import { hasOriginPermission } from '@/lib/permissions';

export const WebhookUrlSchema = z
  .string()
  .url({ message: 'Not a valid URL' })
  .startsWith('https://', { message: 'Webhook URL must use https://' });

/** What we send up the wire. Mirrors the payload documented in the README. */
export type WebhookPayload = {
  source: 'autofilltool';
  version: number;
  submission: SubmissionRecord;
};

export type PostResult =
  | { ok: true; status: number }
  | { ok: false; error: string };

/**
 * POST a submission to the configured URL. Returns a structured result rather
 * than throwing so the UI can render the failure inline.
 */
export async function postSubmission(
  webhookUrl: string,
  record: SubmissionRecord,
  fetchImpl: typeof fetch = fetch,
): Promise<PostResult> {
  const parsed = WebhookUrlSchema.safeParse(webhookUrl);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: issue?.message ?? 'Invalid webhook URL' };
  }

  const permitted = await hasOriginPermission(webhookUrl);
  if (!permitted) {
    return {
      ok: false,
      error:
        'No host permission for this URL. Open Options and click "Grant permission".',
    };
  }

  const payload: WebhookPayload = {
    source: 'autofilltool',
    version: 1,
    submission: record,
  };
  const body = JSON.stringify(payload);

  return attemptPost(webhookUrl, body, fetchImpl, /* allowRetry */ true);
}

/** Send a tiny "ping" so the user can verify their Apps Script is reachable. */
export async function postTestPing(
  webhookUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<PostResult> {
  const parsed = WebhookUrlSchema.safeParse(webhookUrl);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: issue?.message ?? 'Invalid webhook URL' };
  }
  const permitted = await hasOriginPermission(webhookUrl);
  if (!permitted) {
    return {
      ok: false,
      error:
        'No host permission for this URL. Click "Grant permission" first.',
    };
  }
  const body = JSON.stringify({
    source: 'autofilltool',
    version: 1,
    test: true,
    at: new Date().toISOString(),
  });
  return attemptPost(webhookUrl, body, fetchImpl, true);
}

async function attemptPost(
  url: string,
  body: string,
  fetchImpl: typeof fetch,
  allowRetry: boolean,
): Promise<PostResult> {
  try {
    // `text/plain` is a CORS-simple content type; the request goes without a
    // preflight, which keeps Apps Script integrations friction-free.
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body,
      // No credentials — this is a one-shot logging POST, not a session.
      credentials: 'omit',
      redirect: 'follow',
    });
    if (res.ok || (res.status >= 200 && res.status < 400)) {
      return { ok: true, status: res.status };
    }
    return {
      ok: false,
      error: `Webhook returned HTTP ${res.status}`,
    };
  } catch (err) {
    if (allowRetry) {
      // One retry — give Apps Script a beat if it just woke up cold.
      await sleep(750);
      return attemptPost(url, body, fetchImpl, false);
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
