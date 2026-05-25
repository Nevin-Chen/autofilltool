/**
 * MV3 service worker. The background is the only place that talks to the AI
 * provider or the user's tracking webhook (added in later steps). It also
 * forwards FILL_PAGE requests from the popup to the active tab's content
 * script — content scripts can't message each other, only the background can.
 *
 * Keep this file lean — the MV3 worker can be torn down at any time, so all
 * state lives in chrome.storage.local.
 */

import { respondAsync, sendToTab } from '@/lib/messaging';
import { log } from '@/lib/logger';
import { getProfile, getSettings } from '@/profile/store';
import {
  isRequestMessage,
  type RequestMessage,
  type ResponseFor,
} from '@/types/messages';

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
      // Make sure the content script is present. If the user opened the popup
      // on a page outside the curated host_permissions list, the static
      // content_scripts entry won't have loaded — inject programmatically.
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

    case 'LOG_SUBMISSION':
      // Wired up in step 6.
      return {
        ok: false,
        error: 'LOG_SUBMISSION not implemented (arrives in step 6).',
      };

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
