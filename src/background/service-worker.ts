/**
 * MV3 service worker. The background is the only place that talks to the AI
 * provider or the user's tracking webhook (added in later steps). For step 1
 * it just routes a small set of profile/settings/ping messages.
 *
 * Keep this file lean — the MV3 worker can be torn down at any time, so all
 * state lives in chrome.storage.local.
 */

import { respondAsync } from '@/lib/messaging';
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

    case 'FILL_PAGE':
      // Wired up in step 2 — for now the background routes to the active
      // tab's content script which will reply with "not implemented yet".
      return {
        ok: false,
        error: 'FILL_PAGE not implemented in step 1 (skeleton).',
      };

    case 'LOG_SUBMISSION':
      // Wired up in step 6.
      return {
        ok: false,
        error: 'LOG_SUBMISSION not implemented in step 1 (skeleton).',
      };

    default: {
      // Exhaustiveness check.
      const _exhaustive: never = msg;
      void _exhaustive;
      return { ok: false, error: 'Unknown message type' };
    }
  }
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
