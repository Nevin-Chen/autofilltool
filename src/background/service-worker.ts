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
  clearHistory,
} from '@/profile/store';
import {
  isRequestMessage,
  type RequestMessage,
  type ResponseFor,
} from '@/types/messages';
import { SubmissionRecordSchema, type SubmissionRecord } from '@/profile/schema';
import { postSubmission, postTestPing } from '@/tracking/sheets-webhook';
import { dispatch as dispatchAi, classifyField } from '@/ai/client';
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
      const targets = pickTargetFrames(frames);
      if (targets.length === 0) {
        return { ok: false, error: 'No reachable frames on this tab.' };
      }
      const responses = await Promise.all(
        targets.map(async (f) => {
          try {
            return (await sendToFrameWithRetry(
              msg.tabId,
              msg,
              f.frameId,
            )) as ResponseFor<typeof msg>;
          } catch (err) {
            return {
              ok: false as const,
              error: err instanceof Error ? err.message : String(err),
            };
          }
        }),
      );
      const merged = mergeFillResponses(responses);

      if (merged.ok && merged.value.fieldsDetected === 0) {
        chrome.tabs
          .sendMessage(
            msg.tabId,
            { type: 'SHOW_NOTICE', text: 'No application form detected on this page' },
            { frameId: 0 },
          )
          .catch(() => {
          });
      }
      return merged;
    }

    case 'GET_HISTORY': {
      const list = await getHistory();
      return { ok: true, value: msg.limit != null ? list.slice(0, msg.limit) : list };
    }

    case 'CLEAR_HISTORY': {
      await clearHistory();
      return { ok: true, value: { cleared: true } };
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

    case 'SHOW_NOTICE':
      return { ok: false, error: 'SHOW_NOTICE is content-only' };

    case 'AI_CLASSIFY': {
      try {
        const [settings, profile] = await Promise.all([getSettings(), getProfile()]);
        if (!settings.ai.fallbackClassifier) {
          return { ok: true, value: { value: null } };
        }
        const resume =
          msg.request.fieldType === 'textarea' ? await getResume() : null;
        const value = await classifyField(msg.request, settings.ai, profile, resume);
        return { ok: true, value: { value } };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }

    default: {
      const _: never = msg;
      void _;
      return { ok: false, error: 'Unknown message type' };
    }
  }
}

function isNotReadyError(err: unknown): boolean {
  const m = err instanceof Error ? err.message : String(err);
  return /Could not establish connection|Receiving end does not exist/i.test(m);
}

async function sendToFrameWithRetry(
  tabId: number,
  message: RequestMessage,
  frameId: number,
  attempts = 6,
  delayMs = 100,
): Promise<unknown> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await chrome.tabs.sendMessage(tabId, message, { frameId });
    } catch (err) {
      lastErr = err;
      if (!isNotReadyError(err)) throw err;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}

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
      const [settings, resume] = await Promise.all([
        getSettings(),
        getResume(),
      ]);
      log.debug('Suggest: resume snapshot from storage', {
        present: !!resume,
        filename: resume?.filename ?? null,
        mimeType: resume?.mimeType ?? null,
        size: resume?.size ?? 0,
        bytesBase64Length: resume?.bytesBase64.length ?? 0,
        provider: settings.ai.provider,
      });
      const providerHost =
        settings.ai.provider === 'openai'
          ? 'https://api.openai.com/'
          : settings.ai.provider === 'anthropic'
            ? 'https://api.anthropic.com/'
            : settings.ai.provider === 'gemini'
              ? 'https://generativelanguage.googleapis.com/'
              : settings.ai.provider === 'ollama'
                ?
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
      for await (const ev of dispatchAi(req, settings.ai, resume)) {
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
  }
}

function allowSessionStorageInContentScripts(): void {
  try {
    void chrome.storage.session
      .setAccessLevel({
        accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' as chrome.storage.AccessLevel,
      })
      ?.catch((err: unknown) => log.warn('session setAccessLevel failed', err));
  } catch (err) {
    log.warn('session setAccessLevel threw', err);
  }
}

allowSessionStorageInContentScripts();

chrome.runtime.onInstalled.addListener((details) => {
  log.info('installed', details.reason);
  allowSessionStorageInContentScripts();
});

chrome.runtime.onStartup.addListener(() => {
  allowSessionStorageInContentScripts();
});

self.addEventListener('activate', () => {
  log.debug('service worker activated');
});

const ATS_HOST_RE =
  /(^|\.)(greenhouse\.io|lever\.co|ashbyhq\.com|myworkdayjobs\.com)$/i;

function isAtsUrl(raw: string | undefined): boolean {
  if (!raw) return false;
  try {
    return ATS_HOST_RE.test(new URL(raw).hostname);
  } catch {
    return false;
  }
}

function getParentStubPath(): string | null {
  const manifest = chrome.runtime.getManifest();
  for (const entry of manifest.content_scripts ?? []) {
    const matches = entry.matches ?? [];
    if (matches.some((m) => m.includes('aft-parent-stub-bundle-marker'))) {
      return entry.js?.[0] ?? null;
    }
  }
  return null;
}

if (
  typeof chrome !== 'undefined' &&
  chrome.webNavigation &&
  typeof chrome.webNavigation.onCommitted?.addListener === 'function'
) {
  chrome.webNavigation.onCommitted.addListener(async (details) => {
    if (details.frameId === 0) return;
    if (!isAtsUrl(details.url)) return;

    const stubPath = getParentStubPath();
    if (!stubPath) {
      log.warn('parent-stub path not found in manifest; skipping injection');
      return;
    }
    try {
      await chrome.scripting.executeScript({
        target: { tabId: details.tabId, frameIds: [0] },
        files: [stubPath],
      });
      log.debug('parent-stub injected into tab', details.tabId);
    } catch (err) {
      log.warn('parent-stub injection failed', err);
    }
  });
}
