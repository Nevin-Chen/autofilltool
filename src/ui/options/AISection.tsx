/**
 * AI section of the Options page. Provider radio, API key (stored locally,
 * never synced), model picker with sensible defaults, optional response
 * cache, plus a one-shot Test button that fires a tiny completion through
 * the background to confirm the key + permission combo actually works.
 *
 * Mirrors the Tracking section's permission pattern: chrome.permissions
 * .request must run from a user gesture, so the Grant button calls it
 * directly from its click handler.
 */

import { useEffect, useMemo, useState } from 'react';
import type { AiProvider, AiSettings } from '@/profile/schema';
import {
  hasOriginPermission,
  requestOriginPermission,
  revokeOriginPermission,
} from '@/lib/permissions';
import { AI_PORT_NAME, type AiBgToClient } from '@/types/ai-port';
import {
  OLLAMA_DEFAULT_BASE,
  OLLAMA_DEFAULT_MODEL,
  resolveOriginForPermission,
} from '@/ai/providers/ollama';

/** Remote-API providers — Ollama is local so it isn't in this table. */
const REMOTE_PROVIDER_HOSTS: Record<
  Exclude<AiProvider, 'none' | 'ollama'>,
  string
> = {
  openai: 'https://api.openai.com/',
  anthropic: 'https://api.anthropic.com/',
  gemini: 'https://generativelanguage.googleapis.com/',
};

const PROVIDER_DEFAULT_MODELS: Record<Exclude<AiProvider, 'none'>, string> = {
  openai: 'gpt-4o-mini',
  anthropic: 'claude-3-5-haiku-20241022',
  gemini: 'gemini-2.5-flash',
  ollama: OLLAMA_DEFAULT_MODEL,
};

/** Every provider's default model — used to detect an untouched model field. */
const KNOWN_DEFAULT_MODELS = new Set<string>(
  Object.values(PROVIDER_DEFAULT_MODELS),
);

const PROVIDER_KEY_HINT: Record<Exclude<AiProvider, 'none' | 'ollama'>, string> = {
  openai: 'sk-…',
  anthropic: 'sk-ant-…',
  gemini: 'AIza…',
};

const PROVIDER_KEY_URL: Record<Exclude<AiProvider, 'none' | 'ollama'>, string> = {
  openai: 'https://platform.openai.com/api-keys',
  anthropic: 'https://console.anthropic.com/settings/keys',
  gemini: 'https://aistudio.google.com/app/apikey',
};

type Status =
  | { kind: 'idle' }
  | { kind: 'info'; text: string }
  | { kind: 'ok'; text: string }
  | { kind: 'error'; text: string };

export type AISectionProps = {
  settings: AiSettings;
  /** Provider persisted to storage; marks the matching radio as "(current)". */
  savedProvider?: AiProvider;
  onChange: (next: AiSettings) => void;
};

/** Small "(current)" badge on the provider that's actually saved to storage. */
function CurrentTag() {
  return (
    <span className="text-[11px] font-normal text-emerald-600 dark:text-emerald-400">
      (current)
    </span>
  );
}

export function AISection({ settings, savedProvider, onChange }: AISectionProps) {
  const [granted, setGranted] = useState<boolean | null>(null);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [testing, setTesting] = useState(false);

  const providerHost = useMemo(() => {
    if (settings.provider === 'none') return null;
    if (settings.provider === 'ollama') {
      return resolveOriginForPermission(settings.endpoint || OLLAMA_DEFAULT_BASE);
    }
    return REMOTE_PROVIDER_HOSTS[settings.provider];
  }, [settings.provider, settings.endpoint]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!providerHost) {
        if (!cancelled) setGranted(null);
        return;
      }
      try {
        const ok = await hasOriginPermission(providerHost);
        if (!cancelled) setGranted(ok);
      } catch {
        if (!cancelled) setGranted(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [providerHost]);

  const setProvider = (provider: AiProvider) => {
    // Swap the model to the new provider's default unless the user typed a
    // custom one. A blank field or any known per-provider default counts as
    // "untouched", so switching providers always shows that provider's model
    // rather than a stale value from the previously selected provider.
    const hasCustomModel =
      settings.model.length > 0 && !KNOWN_DEFAULT_MODELS.has(settings.model);
    const next: AiSettings = {
      ...settings,
      provider,
      model:
        provider === 'none'
          ? ''
          : hasCustomModel
            ? settings.model
            : PROVIDER_DEFAULT_MODELS[provider],
    };
    onChange(next);
    setStatus({ kind: 'idle' });
  };

  const onGrant = async () => {
    if (!providerHost) return;
    setStatus({ kind: 'info', text: 'Requesting permission…' });
    try {
      const ok = await requestOriginPermission(providerHost);
      setGranted(ok);
      setStatus(
        ok
          ? { kind: 'ok', text: 'Permission granted.' }
          : { kind: 'error', text: 'Permission denied.' },
      );
    } catch (err) {
      setStatus({
        kind: 'error',
        text: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const onRevoke = async () => {
    if (!providerHost) return;
    try {
      await revokeOriginPermission(providerHost);
      setGranted(false);
      setStatus({ kind: 'info', text: 'Permission revoked.' });
    } catch (err) {
      setStatus({
        kind: 'error',
        text: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const onTest = async () => {
    if (settings.provider === 'none') {
      setStatus({ kind: 'error', text: 'Pick a provider first.' });
      return;
    }
    // Ollama runs locally and doesn't need an API key; every other provider
    // does.
    if (settings.provider !== 'ollama' && !settings.apiKey) {
      setStatus({ kind: 'error', text: 'Add an API key first.' });
      return;
    }
    setTesting(true);
    setStatus({ kind: 'info', text: 'Sending test prompt…' });
    try {
      const result = await streamOnce({
        question: 'Reply with the single word: ready.',
      });
      if (result.ok) {
        setStatus({
          kind: 'ok',
          text: `Got a response (${result.chars} characters). Looks good.`,
        });
      } else {
        setStatus({ kind: 'error', text: result.error });
      }
    } catch (err) {
      setStatus({
        kind: 'error',
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <section>
      <h2 className="text-base font-semibold">AI suggestions (optional)</h2>
      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
        Adds a <span aria-hidden="true">✨</span> Suggest button next to
        open-ended textareas. Your API key is stored locally and used only
        for the requests you trigger.
      </p>

      <div className="mt-3 space-y-3">
        <div>
          <span className="mb-1 block text-sm text-slate-700 dark:text-slate-200">
            Provider
          </span>
          <div className="flex flex-wrap gap-3 text-sm">
            <label className="inline-flex items-center gap-2">
              <input
                type="radio"
                name="ai-provider"
                checked={settings.provider === 'none'}
                onChange={() => setProvider('none')}
              />
              None
              {savedProvider === 'none' && <CurrentTag />}
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="radio"
                name="ai-provider"
                checked={settings.provider === 'openai'}
                onChange={() => setProvider('openai')}
              />
              OpenAI
              {savedProvider === 'openai' && <CurrentTag />}
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="radio"
                name="ai-provider"
                checked={settings.provider === 'anthropic'}
                onChange={() => setProvider('anthropic')}
              />
              Anthropic
              {savedProvider === 'anthropic' && <CurrentTag />}
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="radio"
                name="ai-provider"
                checked={settings.provider === 'gemini'}
                onChange={() => setProvider('gemini')}
              />
              Google Gemini
              {savedProvider === 'gemini' && <CurrentTag />}
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="radio"
                name="ai-provider"
                checked={settings.provider === 'ollama'}
                onChange={() => setProvider('ollama')}
              />
              Ollama (local)
              {savedProvider === 'ollama' && <CurrentTag />}
            </label>
          </div>
          {settings.provider === 'gemini' && (
            <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
              <span className="font-mono">gemini-2.5-flash</span> is
              rate-limited but doesn&apos;t require a card. Grab a key at{' '}
              <a
                href={PROVIDER_KEY_URL.gemini}
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                aistudio.google.com/app/apikey
              </a>
              .
            </p>
          )}
          {settings.provider === 'ollama' && (
            <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
              Runs entirely on your machine — no key, no network. Install{' '}
              <a
                href="https://ollama.com"
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                Ollama
              </a>{' '}
              then pull a model:{' '}
              <code className="font-mono">ollama pull {OLLAMA_DEFAULT_MODEL}</code>.
              Default endpoint:{' '}
              <span className="font-mono">{OLLAMA_DEFAULT_BASE}</span>.
            </p>
          )}
        </div>

        {settings.provider !== 'none' && (
          <>
            {settings.provider !== 'ollama' && (
              <label className="block text-sm">
                <span className="mb-1 block text-slate-700 dark:text-slate-200">
                  API key
                </span>
                <input
                  type="password"
                  value={settings.apiKey}
                  onChange={(e) => {
                    onChange({ ...settings, apiKey: e.target.value.trim() });
                    setStatus({ kind: 'idle' });
                  }}
                  placeholder={PROVIDER_KEY_HINT[settings.provider]}
                  autoComplete="off"
                  spellCheck={false}
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 font-mono text-xs shadow-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                />
              </label>
            )}

            {settings.provider === 'ollama' && (
              <label className="block text-sm">
                <span className="mb-1 block text-slate-700 dark:text-slate-200">
                  Endpoint
                </span>
                <input
                  type="text"
                  value={settings.endpoint}
                  onChange={(e) => {
                    onChange({ ...settings, endpoint: e.target.value.trim() });
                    setStatus({ kind: 'idle' });
                  }}
                  placeholder={OLLAMA_DEFAULT_BASE}
                  autoComplete="off"
                  spellCheck={false}
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 font-mono text-xs shadow-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                />
                <span className="mt-1 block text-[11px] text-slate-500 dark:text-slate-400">
                  Leave blank for the localhost default. Point at a LAN host
                  (e.g. <span className="font-mono">http://192.168.1.10:11434</span>)
                  if Ollama runs on another machine.
                </span>
              </label>
            )}

            <label className="block text-sm">
              <span className="mb-1 block text-slate-700 dark:text-slate-200">
                Model
              </span>
              <input
                type="text"
                value={settings.model}
                onChange={(e) => onChange({ ...settings, model: e.target.value.trim() })}
                placeholder={PROVIDER_DEFAULT_MODELS[settings.provider]}
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm shadow-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              />
              <span className="mt-1 block text-[11px] text-slate-500 dark:text-slate-400">
                Leave blank to use the default ({PROVIDER_DEFAULT_MODELS[settings.provider]}).
              </span>
            </label>

            <label className="flex items-start gap-3 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={settings.cacheResponses}
                onChange={(e) =>
                  onChange({ ...settings, cacheResponses: e.target.checked })
                }
              />
              <span>
                <span className="font-medium">Cache responses locally</span>
                <span className="block text-slate-500 dark:text-slate-400">
                  Stores the last response per question-hash in
                  chrome.storage.local. Off by default; nothing is stored
                  otherwise.
                </span>
              </span>
            </label>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={onGrant}
                disabled={granted === true}
                className="rounded-md bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-50"
              >
                {granted ? 'Permission granted' : `Grant permission for ${providerHost}`}
              </button>
              {granted && (
                <button
                  type="button"
                  onClick={onRevoke}
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  Revoke
                </button>
              )}
              <button
                type="button"
                onClick={onTest}
                disabled={
                  !granted ||
                  testing ||
                  (settings.provider !== 'ollama' && !settings.apiKey)
                }
                className="rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                {testing ? 'Testing…' : 'Test'}
              </button>
            </div>
          </>
        )}

        {status.kind !== 'idle' && (
          <div
            className={
              status.kind === 'ok'
                ? 'rounded-md border border-emerald-300 bg-emerald-50 p-2 text-xs text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300'
                : status.kind === 'error'
                  ? 'rounded-md border border-rose-300 bg-rose-50 p-2 text-xs text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300'
                  : 'rounded-md border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300'
            }
          >
            {status.text}
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * Quick streaming round-trip used by the Test button. We collect deltas
 * until the stream completes; the test passes if anything came back.
 */
function streamOnce(req: { question: string }): Promise<
  { ok: true; chars: number } | { ok: false; error: string }
> {
  return new Promise((resolve) => {
    let chars = 0;
    let settled = false;
    const finish = (v: { ok: true; chars: number } | { ok: false; error: string }) => {
      if (settled) return;
      settled = true;
      resolve(v);
      try {
        port.disconnect();
      } catch {
        /* ignore */
      }
    };
    const port = chrome.runtime.connect({ name: AI_PORT_NAME });
    port.onMessage.addListener((m: AiBgToClient) => {
      if (m.kind === 'delta') chars += m.text.length;
      else if (m.kind === 'done') finish({ ok: true, chars });
      else if (m.kind === 'error') finish({ ok: false, error: m.message });
    });
    port.onDisconnect.addListener(() =>
      finish({ ok: false, error: 'Disconnected before reply.' }),
    );
    port.postMessage({ kind: 'start', req });
    setTimeout(
      () => finish({ ok: false, error: 'Test timed out after 20s.' }),
      20000,
    );
  });
}
