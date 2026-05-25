/**
 * MV3 service worker. The background is the only place that talks to the
 * user's tracking webhook or (later) the AI provider — content scripts share
 * the page's origin and would get CORS-blocked. It also forwards FILL_PAGE
 * from the popup to the active tab's content script.
 *
 * Keep this file lean — MV3 workers can be torn down at any time, so all
 * state lives in chrome.storage.local.
 */

import { respondAsync, sendToTab } from '@/lib/messaging';
import { log } from '@/lib/logger';
import {
  getProfile,
  getSettings,
  getHistory,
  pushHistory,
} from '@/profile/store';
import {
  isRequestMessage,
  type RequestMessage,
  type ResponseFor,
} from '@/types/messages';
import { SubmissionRecordSchema, type SubmissionRecord } from '@/profile/schema';
import { postSubmission, postTestPing } from '@/tracking/sheets-webhook';

async function handle(msg: RequestMessage): Promise<ResponseFor<RequestMessage>> {
  switch (msg.type) {
    case 'PING':
      return { ok: true, value: { pong: true, at: new Date().toISOString() } };

    case 'GET_PROFILE': {
      const profile = await getProfile();
      return { ok: true, value: profile };
    }

    case 'GET_SETTINGS': {
      const settings = await getSettings();
      return { ok: true, value: settings };
    }

    case 'FILL_PAGE': {
      try {
        await ensureContentScript(msg.tabId);
      } catch (err) {
        return {
          ok: false,
          error:
            err instanceof Error
              ? `Could not access this page: ${err.message}`
              : 'Could not access this page.',
        };
      }
      return sendToTab(msg.tabId, msg);
    }

    case 'GET_HISTORY': {
      const list = await getHistory();
      const limit = msg.limit ?? 25;
      return { ok: true, value: list.slice(0, limit) };
    }

    case 'TEST_WEBHOOK': {
      const settings = await getSettings();
      const url = settings.tracking.webhookUrl;
      if (!url) return { ok: false, error: 'No webhook URL set in Options.' };
      const result = await postTestPing(url);
      if (!result.ok) return { ok: false, error: result.error };
      return { ok: true, value: { status: result.status } };
    }

    case 'LOG_SUBMISSION': {
      // Fill in id + timestamp + run through the schema so anything malformed
      // is rejected before it hits storage.
      const candidate = {
        id: msg.record.id ?? crypto.randomUUID(),
        timestamp: msg.record.timestamp ?? new Date().toISOString(),
        company: msg.record.company ?? '',
        role: msg.record.role ?? '',
        jobUrl: msg.record.jobUrl ?? '',
        source: msg.record.source,
        status: msg.record.status,
        note: msg.record.note ?? '',
      };
      const parsed = SubmissionRecordSchema.safeParse(candidate);
      if (!parsed.success) {
        return {
          ok: false,
          error: `Invalid submission: ${parsed.error.issues[0]?.message ?? 'unknown'}`,
        };
      }
      const record: SubmissionRecord = parsed.data;

      await pushHistory(record);

      const settings = await getSettings();
      const url = settings.tracking.webhookUrl;
      if (!url) {
        return {
          ok: true,
          value: { stored: true, posted: false, record },
        };
      }
      const post = await postSubmission(url, record);
      if (!post.ok) {
        return {
          ok: true,
          value: { stored: true, posted: false, webhookError: post.error, record },
        };
      }
      return { ok: true, value: { stored: true, posted: true, record } };
    }

    default: {
      const _: never = msg;
      void _;
      return { ok: false, error: 'Unknown message type' };
    }
  }
}

/**
 * Ping the tab's content script. If it doesn't answer, inject our entry
 * point with chrome.scripting and try again. activeTab grants temporary
 * permission for the focused tab even when its host isn't pre-permissioned.
 *
 * NOTE: the build pipeline (crxjs) rewrites the manifest's `content_scripts`
 * entry to a hashed file path. We read that path from the live manifest so
 * we don't hard-code a stale source filename.
 */
async function ensureContentScript(tabId: number): Promise<void> {
  try {
    const pong = await chrome.tabs.sendMessage(tabId, { type: 'PING' });
    if (pong && (pong as { ok?: boolean }).ok !== undefined) return;
  } catch {
    // Not loaded yet — fall through to injection.
  }
  const manifest = chrome.runtime.getManifest();
  const contentJs = manifest.content_scripts?.[0]?.js?.[0];
  if (!contentJs) {
    throw new Error('content script bundle not declared in manifest');
  }
  await chrome.scripting.executeScript({
    target: { tabId },
    files: [contentJs],
  });
}

chrome.runtime.onMessage.addListener(
  respondAsync<unknown, ResponseFor<RequestMessage>>(async (raw) => {
    if (!isRequestMessage(raw)) {
      return { ok: false, error: 'Malformed message' } as ResponseFor<RequestMessage>;
    }
    return handle(raw);
  }),
);

chrome.runtime.onInstalled.addListener((details) => {
  log.info('installed', details.reason);
});

self.addEventListener('activate', () => {
  log.debug('service worker activated');
});
