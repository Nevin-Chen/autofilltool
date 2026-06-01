/**
 * Tracking section of the Options page. Manages the webhook URL, the host
 * permission grant for that URL, and a "Send test ping" verification step.
 *
 * Permission requests must originate from a user gesture, so the "Grant
 * permission" button calls chrome.permissions.request directly from its
 * click handler rather than going through the background worker.
 */

import { useEffect, useState } from 'react';
import {
  hasOriginPermission,
  requestOriginPermission,
  revokeOriginPermission,
} from '@/lib/permissions';
import { WebhookUrlSchema } from '@/tracking/sheets-webhook';
import { sendToBackground } from '@/lib/messaging';

type Status =
  | { kind: 'idle' }
  | { kind: 'info'; text: string }
  | { kind: 'ok'; text: string }
  | { kind: 'error'; text: string };

export type TrackingSectionProps = {
  url: string;
  onChange: (url: string) => void;
  autoLogOnSubmit: boolean;
  onAutoLogChange: (value: boolean) => void;
};

export function TrackingSection({
  url,
  onChange,
  autoLogOnSubmit,
  onAutoLogChange,
}: TrackingSectionProps) {
  const [granted, setGranted] = useState<boolean | null>(null);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [testing, setTesting] = useState(false);

  // Keep the "granted" indicator in sync with the URL the user has typed.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!url) {
        if (!cancelled) setGranted(null);
        return;
      }
      try {
        const ok = await hasOriginPermission(url);
        if (!cancelled) setGranted(ok);
      } catch {
        if (!cancelled) setGranted(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url]);

  const validation = url ? WebhookUrlSchema.safeParse(url) : null;
  const urlValid = validation?.success ?? false;
  const urlError = validation && !validation.success
    ? validation.error.issues[0]?.message ?? 'Invalid URL'
    : null;

  const onGrant = async () => {
    setStatus({ kind: 'info', text: 'Requesting permission…' });
    try {
      const ok = await requestOriginPermission(url);
      setGranted(ok);
      setStatus(
        ok
          ? { kind: 'ok', text: 'Permission granted.' }
          : {
              kind: 'error',
              text: 'Permission denied. Without it, the extension cannot POST to this URL.',
            },
      );
    } catch (err) {
      setStatus({
        kind: 'error',
        text: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const onRevoke = async () => {
    try {
      await revokeOriginPermission(url);
      setGranted(false);
      setStatus({ kind: 'info', text: 'Permission revoked for this origin.' });
    } catch (err) {
      setStatus({
        kind: 'error',
        text: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const onTest = async () => {
    setTesting(true);
    setStatus({ kind: 'info', text: 'Sending test ping…' });
    try {
      const res = await sendToBackground({ type: 'TEST_WEBHOOK' });
      if (res.ok) {
        setStatus({
          kind: 'ok',
          text: `Test ping succeeded (HTTP ${res.value.status}). Check your sheet.`,
        });
      } else {
        setStatus({ kind: 'error', text: res.error });
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
      <h2 className="text-base font-semibold">Tracking (optional)</h2>
      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
        Paste a Google Apps Script web-app URL. When you click <em>Mark
        submitted</em> on a job page, the extension POSTs a JSON record to
        this URL. The URL is stored locally and never synced.
      </p>

      <div className="mt-3 space-y-3">
        <label className="block text-sm">
          <span className="mb-1 block text-slate-700 dark:text-slate-200">
            Webhook URL
          </span>
          <input
            type="url"
            value={url}
            onChange={(e) => {
              onChange(e.target.value.trim());
              setStatus({ kind: 'idle' });
            }}
            placeholder="https://script.google.com/macros/s/AKfy.../exec"
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm shadow-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
          />
          {urlError && (
            <span className="mt-1 block text-xs text-rose-600 dark:text-rose-400">
              {urlError}
            </span>
          )}
        </label>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onGrant}
            disabled={!urlValid || granted === true}
            className="rounded-md bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-50"
          >
            {granted ? 'Permission granted' : 'Grant permission'}
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
            disabled={!urlValid || !granted || testing}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            {testing ? 'Testing…' : 'Send test ping'}
          </button>
        </div>

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

        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={autoLogOnSubmit}
            onChange={(e) => onAutoLogChange(e.target.checked)}
            className="mt-0.5"
          />
          <span className="text-slate-700 dark:text-slate-200">
            Log automatically when I submit
            <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">
              Records the application the moment your own submission is confirmed
              on the page — no “Mark submitted” click. The extension only watches
              your submit; it never clicks Submit for you.
            </span>
          </span>
        </label>

        <p className="text-xs text-slate-500 dark:text-slate-400">
          Need an Apps Script endpoint? See the README for a copy-pasteable
          snippet.
        </p>
      </div>
    </section>
  );
}
