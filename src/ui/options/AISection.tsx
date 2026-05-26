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

const PROVIDER_HOSTS: Record<Exclude<AiProvider, 'none'>, string> = {
  openai: 'https://api.openai.com/',
  anthropic: 'https://api.anthropic.com/',
};

const PROVIDER_DEFAULT_MODELS: Record<Exclude<AiProvider, 'none'>, string> = {
  openai: 'gpt-4o-mini',
  anthropic: 'claude-3-5-haiku-20241022',
};

type Status =
  | { kind: 'idle' }
  | { kind: 'info'; text: string }
  | { kind: 'ok'; text: string }
  | { kind: 'error'; text: string };

export type AISectionProps = {
  settings: AiSettings;
  onChange: (next: AiSettings) => void;
};

export function AISection({ settings, onChange }: AISectionProps) {
  const [granted, setGranted] = useState<boolean | null>(null);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [testing, setTesting] = useState(false);

  const providerHost = useMemo(() => {
    if (settings.provider === 'none') return null;
    return PROVIDER_HOSTS[settings.provider];
  }, [settings.provider]);

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
    const next: AiSettings = {
      ...settings,
      provider,
      model:
        provider === 'none'
          ? ''
          : settings.model || PROVIDER_DEFAULT_MODELS[provider],
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
    if (settings.provider === 'none' || !settings.apiKey) {
      setStatus({ kind: 'error', text: 'Pick a provider and add an API key first.' });
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
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="radio"
                name="ai-provider"
                checked={settings.provider === 'openai'}
                onChange={() => setProvider('openai')}
              />
              OpenAI
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="radio"
                name="ai-provider"
                checked={settings.provider === 'anthropic'}
                onChange={() => setProvider('anthropic')}
              />
              Anthropic
            </label>
          </div>
        </div>

        {settings.provider !== 'none' && (
          <>
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
                placeholder={
                  settings.provider === 'openai' ? 'sk-…' : 'sk-ant-…'
                }
                autoComplete="off"
                spellCheck={false}
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 font-mono text-xs shadow-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              />
            </label>

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
                disabled={!granted || !settings.apiKey || testing}
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
