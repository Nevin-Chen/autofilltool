/**
 * POSTs submission records to the user's webhook (usually a Google Apps Script
 * URL), from the background worker only (content scripts would be CORS-blocked).
 * Sent as `text/plain` deliberately — Apps Script reads `e.postData.contents`
 * and a simple content type skips the CORS preflight. Retries once on transient
 * errors; validates the URL via zod so bad config fails loudly.
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
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // CORS-simple, no preflight
      body,
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
      // One retry — give a cold-starting Apps Script a beat.
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
