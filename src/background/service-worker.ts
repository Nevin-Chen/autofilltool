/**
 * MV3 service worker — the only place that talks to the webhook or AI provider
 * (content scripts share the page origin and get CORS-blocked); also forwards
 * FILL_PAGE to the active tab. Keep lean: workers can be torn down anytime, so
 * all state lives in chrome.storage.local.
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
      // ATS frames only, else the top frame (see frames.ts).
      const targets = pickTargetFrames(frames);
      if (targets.length === 0) {
        return { ok: false, error: 'No reachable frames on this tab.' };
      }
      // Broadcast in parallel. sendMessage throws on a frame with no listener
      // (sandboxed iframe we couldn't inject); capture as a per-frame error.
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
      // Fill id + timestamp, then validate so malformed records never hit storage.
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
 * Inject the content script into every frame of `tabId`, then report which
 * frames are reachable. A window-level guard (`__autofilltool_loaded__`) makes
 * re-injection a no-op, so we can call this unconditionally without PING-first.
 *
 * Every frame because ATS forms are iframed on the company's career domain;
 * sendMessage only reaches the top frame unless we pass `frameId`, so the
 * caller needs the full list. activeTab grants the cross-origin inject. The
 * content-script path is read from the live manifest (crxjs hashes it).
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
  // Probe each frame for location.href + a DOM ATS hint. Self-contained:
  // chrome.scripting runs it in an isolated world without our imports.
  const results = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: () => {
      const doc = document;
      let atsHint: 'greenhouse' | 'lever' | 'ashby' | 'workday' | null = null;
      if (
        doc.getElementById('grnhse_app') ||
        doc.getElementById('grnhse_iframe') ||
        doc.querySelector('form#application-form') ||
        (doc.querySelector('input[name="first_name"]') &&
          doc.querySelector('input[name="last_name"]') &&
          doc.querySelector('input[name="email"]'))
      ) {
        atsHint = 'greenhouse';
      } else if (doc.querySelector('[data-qa="application-form"]')) {
        atsHint = 'lever';
      } else if (doc.querySelector('[data-testid="FieldEntry"]')) {
        atsHint = 'ashby';
      } else if (doc.querySelector('[data-automation-id]')) {
        atsHint = 'workday';
      }
      return { url: location.href, atsHint };
    },
  });
  const out: FrameInfo[] = [];
  for (const r of results) {
    const v = r.result;
    if (v && typeof v === 'object' && typeof v.url === 'string') {
      out.push({ frameId: r.frameId, url: v.url, atsHint: v.atsHint });
    }
  }
  log.debug(
    'ensureContentScriptInAllFrames →',
    out.map((f) => `frame${f.frameId}=${f.atsHint ?? 'none'}(${f.url})`).join(', '),
  );
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

/** Long-lived port streaming AI suggestions; one per Suggest click, disconnects on cancel/unload. */
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
                ? // Empty endpoint → localhost default (provider resolves identically).
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
