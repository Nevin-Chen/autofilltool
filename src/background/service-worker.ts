/**
 * MV3 service worker. The background is the only place that talks to the
 * user's tracking webhook or (later) the AI provider — content scripts share
 * the page's origin and would get CORS-blocked. It also forwards FILL_PAGE
 * from the popup to the active tab's content script.
 *
 * Keep this file lean — MV3 workers can be torn down at any time, so all
 * state lives in chrome.storage.local.
 */

import { respondAsync } from '@/lib/messaging';
import {
  pickTargetFrames,
  mergeFillResponses,
  type FrameInfo,
} from './frames';
import { log } from '@/lib/logger';
import {
  getProfile,
  getSettings,
  getHistory,
  getResume,
  pushHistory,
} from '@/profile/store';
import {
  isRequestMessage,
  type RequestMessage,
  type ResponseFor,
} from '@/types/messages';
import { SubmissionRecordSchema, type SubmissionRecord } from '@/profile/schema';
import { postSubmission, postTestPing } from '@/tracking/sheets-webhook';
import { dispatch as dispatchAi } from '@/ai/client';
import {
  OLLAMA_DEFAULT_BASE,
  resolveOriginForPermission,
} from '@/ai/providers/ollama';
import {
  AI_PORT_NAME,
  isAiClientMsg,
  type AiBgToClient,
} from '@/types/ai-port';
import { hasOriginPermission } from '@/lib/permissions';

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
      let frames: FrameInfo[];
      try {
        frames = await ensureContentScriptInAllFrames(msg.tabId);
      } catch (err) {
        return {
          ok: false,
          error:
            err instanceof Error
              ? `Could not access this page: ${err.message}`
              : 'Could not access this page.',
        };
      }
      // Pick the frames that actually host an ATS form (or fall back to the
      // top frame). See src/background/frames.ts for the rationale.
      const targets = pickTargetFrames(frames);
      if (targets.length === 0) {
        return { ok: false, error: 'No reachable frames on this tab.' };
      }
      // Broadcast FILL_PAGE in parallel, collect each frame's response.
      // chrome.tabs.sendMessage throws when a target frame has no listener
      // (e.g. a sandboxed iframe we couldn't inject into); we capture that
      // as a per-frame error and let the merger decide what to surface.
      const responses = await Promise.all(
        targets.map(async (f) => {
          try {
            return (await chrome.tabs.sendMessage(msg.tabId, msg, {
              frameId: f.frameId,
            })) as ResponseFor<typeof msg>;
          } catch (err) {
            return {
              ok: false as const,
              error: err instanceof Error ? err.message : String(err),
            };
          }
        }),
      );
      return mergeFillResponses(responses);
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
 * Inject the content script bundle into every frame of `tabId`, then
 * report which frames are reachable. The content script has a window-level
 * guard (`__autofilltool_loaded__`) so re-injection on already-loaded
 * frames is a no-op for listener registration — that's what lets us call
 * this unconditionally without PING-first.
 *
 * Why every frame: companies embed ATS application forms inside iframes
 * on their own career-page domains. The form HTML lives inside the iframe
 * on `boards.greenhouse.io` (or similar); the parent page is on
 * `company.com`. `chrome.tabs.sendMessage(tabId, msg)` only reaches the
 * top frame unless we pass `frameId` explicitly, so the caller needs the
 * full frame list to broadcast.
 *
 * activeTab grants the per-tab permission needed to inject across origins
 * for the focused tab.
 *
 * NOTE: the build pipeline (crxjs) rewrites the manifest's
 * `content_scripts` entry to a hashed file path. We read that path from
 * the live manifest so we don't hard-code a stale source filename.
 */
async function ensureContentScriptInAllFrames(
  tabId: number,
): Promise<FrameInfo[]> {
  const manifest = chrome.runtime.getManifest();
  const contentJs = manifest.content_scripts?.[0]?.js?.[0];
  if (!contentJs) {
    throw new Error('content script bundle not declared in manifest');
  }
  await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    files: [contentJs],
  });
  const results = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: () => location.href,
  });
  const out: FrameInfo[] = [];
  for (const r of results) {
    if (typeof r.result === 'string') {
      out.push({ frameId: r.frameId, url: r.result });
    }
  }
  return out;
}

chrome.runtime.onMessage.addListener(
  respondAsync<unknown, ResponseFor<RequestMessage>>(async (raw) => {
    if (!isRequestMessage(raw)) {
      return { ok: false, error: 'Malformed message' } as ResponseFor<RequestMessage>;
    }
    return handle(raw);
  }),
);

/* ------------------------------------------------------- AI streaming */

/**
 * Long-lived port for streaming AI suggestions back to the content script.
 * One connection per Suggest click; the content script disconnects on
 * cancel / page unload.
 */
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== AI_PORT_NAME) return;
  let aborted = false;
  port.onDisconnect.addListener(() => {
    aborted = true;
  });
  port.onMessage.addListener((raw) => {
    if (!isAiClientMsg(raw)) return;
    if (raw.kind === 'cancel') {
      aborted = true;
      return;
    }
    void runSuggest(port, raw.req).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      safePost(port, { kind: 'error', message });
    });

    async function runSuggest(p: chrome.runtime.Port, req: typeof raw.req) {
      const [settings, profile, resume] = await Promise.all([
        getSettings(),
        getProfile(),
        getResume(),
      ]);
      const providerHost =
        settings.ai.provider === 'openai'
          ? 'https://api.openai.com/'
          : settings.ai.provider === 'anthropic'
            ? 'https://api.anthropic.com/'
            : settings.ai.provider === 'gemini'
              ? 'https://generativelanguage.googleapis.com/'
              : settings.ai.provider === 'ollama'
                ? // Empty endpoint → localhost default. The provider module
                  // resolves this identically when actually fetching.
                  resolveOriginForPermission(
                    settings.ai.endpoint || OLLAMA_DEFAULT_BASE,
                  ) ?? ''
                : '';
      if (providerHost) {
        const permitted = await hasOriginPermission(providerHost);
        if (!permitted) {
          safePost(p, {
            kind: 'error',
            message:
              'No host permission for the AI provider. Open Options → AI and click Grant.',
          });
          return;
        }
      }
      for await (const ev of dispatchAi(req, settings.ai, profile, resume)) {
        if (aborted) return;
        safePost(p, ev);
      }
    }
  });
});

function safePost(port: chrome.runtime.Port, msg: AiBgToClient): void {
  try {
    port.postMessage(msg);
  } catch {
    // Disconnected mid-stream — ignore; the receiver gave up.
  }
}

/* ------------------------------------------------------- lifecycle */

chrome.runtime.onInstalled.addListener((details) => {
  log.info('installed', details.reason);
});

self.addEventListener('activate', () => {
  log.debug('service worker activated');
});
