/**
 * Export / Import section of Options — the only UI for encrypted backups. Pulls
 * live profile+settings from the parent's form state (so exports capture
 * unsaved edits) plus résumé+history from storage, encrypts via
 * profile/encryption.ts; import reverses it through the typed store setters.
 * The passphrase lives only in React state and is cleared after each op.
 */

import { useRef, useState } from 'react';
import type { Profile, Settings } from '@/profile/schema';
import {
  getResume,
  getHistory,
  setProfile,
  setSettings,
  setResume,
  clearResume,
  replaceHistory,
} from '@/profile/store';
import {
  encryptPayload,
  decryptPayload,
  buildPayload,
  suggestedExportFilename,
} from '@/profile/encryption';

type Status =
  | { kind: 'idle' }
  | { kind: 'info'; text: string }
  | { kind: 'ok'; text: string }
  | { kind: 'error'; text: string };

export type ExportImportSectionProps = {
  /** Live form state from OptionsApp, so an export includes unsaved edits. */
  profile: Profile;
  settings: Settings;
  /** Called after a successful import so the parent can reload its state. */
  onImported: (profile: Profile, settings: Settings) => void;
};

export function ExportImportSection({
  profile,
  settings,
  onImported,
}: ExportImportSectionProps) {
  const [pass, setPass] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const fileRef = useRef<HTMLInputElement>(null);

  const onExport = async () => {
    if (pass.length < 8) {
      setStatus({ kind: 'error', text: 'Passphrase must be at least 8 characters.' });
      return;
    }
    if (pass !== confirm) {
      setStatus({ kind: 'error', text: 'Passphrases do not match.' });
      return;
    }
    setBusy(true);
    setStatus({ kind: 'info', text: 'Encrypting…' });
    try {
      const [resume, history] = await Promise.all([getResume(), getHistory()]);
      const payload = buildPayload({ profile, settings, resume, history });
      const envelope = await encryptPayload(payload, pass);
      const blob = new Blob([JSON.stringify(envelope, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = suggestedExportFilename();
      a.click();
      URL.revokeObjectURL(url);
      setStatus({ kind: 'ok', text: 'Backup downloaded.' });
    } catch (err) {
      setStatus({ kind: 'error', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setPass('');
      setConfirm('');
      setBusy(false);
    }
  };

  const onPickFile = () => fileRef.current?.click();

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset the input so picking the same file again still fires onChange.
    e.target.value = '';
    if (!file) return;
    if (!pass) {
      setStatus({ kind: 'error', text: 'Enter the passphrase before importing.' });
      return;
    }
    setBusy(true);
    setStatus({ kind: 'info', text: 'Decrypting…' });
    try {
      const text = await file.text();
      const envelope = JSON.parse(text) as unknown;
      const payload = await decryptPayload(envelope, pass);
      await Promise.all([
        setProfile(payload.profile),
        setSettings(payload.settings),
        payload.resume ? setResume(payload.resume) : clearResume(),
        replaceHistory(payload.history),
      ]);
      onImported(payload.profile, payload.settings);
      setStatus({ kind: 'ok', text: 'Backup imported. Your data has been restored.' });
    } catch (err) {
      setStatus({ kind: 'error', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setPass('');
      setConfirm('');
      setBusy(false);
    }
  };

  return (
    <section>
      <h2 className="text-base font-semibold">Backup (export / import)</h2>
      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
        Download an encrypted backup of your profile, settings, résumé, and
        history, or restore one. The file is encrypted with your passphrase
        (AES-GCM, PBKDF2) — without it the backup cannot be read, so keep it
        somewhere safe. The passphrase is never stored.
      </p>

      <div className="mt-3 space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1 block text-slate-700 dark:text-slate-200">
              Passphrase
            </span>
            <input
              type="password"
              value={pass}
              autoComplete="new-password"
              onChange={(e) => {
                setPass(e.target.value);
                setStatus({ kind: 'idle' });
              }}
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm shadow-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-slate-700 dark:text-slate-200">
              Confirm passphrase{' '}
              <span className="text-slate-400">(export only)</span>
            </span>
            <input
              type="password"
              value={confirm}
              autoComplete="new-password"
              onChange={(e) => setConfirm(e.target.value)}
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm shadow-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onExport}
            disabled={busy || !pass}
            className="rounded-md bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-50"
          >
            {busy ? 'Working…' : 'Export encrypted backup'}
          </button>
          <button
            type="button"
            onClick={onPickFile}
            disabled={busy || !pass}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Import backup…
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            onChange={onFile}
            className="hidden"
          />
        </div>

        <p className="text-xs text-amber-700 dark:text-amber-400">
          Importing replaces your current profile, settings, résumé, and
          history.
        </p>

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
