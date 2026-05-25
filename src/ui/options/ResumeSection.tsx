/**
 * Resume upload section of the Options page. Loads the stored ResumeRecord
 * (if any), lets the user replace or remove it, and keeps the user informed
 * about size + type limits.
 *
 * The actual file → base64 conversion lives in `@/profile/resume.ts` so the
 * same code path is used at fill time on the content side.
 */

import { useEffect, useState } from 'react';
import { fileToResumeRecord } from '@/profile/resume';
import {
  getResume,
  setResume as persistResume,
  clearResume as removeResume,
} from '@/profile/store';
import type { ResumeRecord } from '@/profile/schema';

const ACCEPTED = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
];
const ACCEPTED_LABEL = '.pdf, .doc, .docx, .txt';
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB; ATSes usually cap around 10 MB

type Status =
  | { kind: 'idle' }
  | { kind: 'info'; text: string }
  | { kind: 'ok'; text: string }
  | { kind: 'error'; text: string };

export function ResumeSection() {
  const [resume, setResumeState] = useState<ResumeRecord | null>(null);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await getResume();
      if (!cancelled) setResumeState(r);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset the input so picking the same file twice still fires onChange.
    e.target.value = '';
    if (!file) return;

    if (file.size > MAX_BYTES) {
      setStatus({
        kind: 'error',
        text: `File is ${formatBytes(file.size)} — limit is ${formatBytes(MAX_BYTES)}.`,
      });
      return;
    }
    if (file.type && !ACCEPTED.includes(file.type)) {
      // Allow if MIME is missing (some OSes don't set it for .docx) but extension matches.
      if (!/\.(pdf|docx?|txt)$/i.test(file.name)) {
        setStatus({
          kind: 'error',
          text: `Unsupported type "${file.type}". Allowed: ${ACCEPTED_LABEL}.`,
        });
        return;
      }
    }

    setStatus({ kind: 'info', text: 'Saving…' });
    try {
      const record = await fileToResumeRecord(file);
      await persistResume(record);
      setResumeState(record);
      setStatus({ kind: 'ok', text: 'Resume saved locally.' });
    } catch (err) {
      setStatus({
        kind: 'error',
        text: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const onRemove = async () => {
    await removeResume();
    setResumeState(null);
    setStatus({ kind: 'info', text: 'Resume removed.' });
  };

  return (
    <section>
      <h2 className="text-base font-semibold">Resume</h2>
      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
        Stored locally in your browser. Attached to file inputs on application
        pages when you click Fill. {ACCEPTED_LABEL}, up to{' '}
        {formatBytes(MAX_BYTES)}.
      </p>

      <div className="mt-3 space-y-3">
        {resume ? (
          <div className="rounded-md border border-slate-200 bg-white p-3 text-sm dark:border-slate-700 dark:bg-slate-800">
            <div className="font-medium text-slate-800 dark:text-slate-100">
              {resume.filename}
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              {resume.mimeType || 'unknown type'} · {formatBytes(resume.size)} ·
              uploaded {new Date(resume.uploadedAt).toLocaleString()}
            </div>
            <div className="mt-2 flex gap-2">
              <label className="cursor-pointer rounded-md bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-500">
                Replace…
                <input
                  type="file"
                  accept={ACCEPTED_LABEL}
                  onChange={onPick}
                  className="hidden"
                />
              </label>
              <button
                type="button"
                onClick={onRemove}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Remove
              </button>
            </div>
          </div>
        ) : (
          <label className="inline-flex cursor-pointer items-center rounded-md bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-500">
            Upload resume…
            <input
              type="file"
              accept={ACCEPTED_LABEL}
              onChange={onPick}
              className="hidden"
            />
          </label>
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

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
