import { useEffect, useState } from 'react';
import { fileToResumeVariant, resumeLibraryBytes } from '@/profile/resume';
import {
  getResumeLibrary,
  addResumeVariant,
  updateResumeVariant,
  removeResumeVariant,
  setDefaultResume,
} from '@/profile/store';
import {
  MAX_RESUME_VARIANTS,
  RESUME_LIBRARY_BUDGET_BYTES,
  emptyResumeLibrary,
  type ResumeLibrary,
  type ResumeVariant,
} from '@/profile/schema';
import { defaultVariant } from '@/profile/resume-select';
import {
  extractResumeText,
  isResumePlaceholder,
} from '@/ai/resume-text';
import { Section } from './Section';

const ACCEPTED = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
];
const ACCEPTED_LABEL = '.pdf, .doc, .docx, .txt';
const MAX_BYTES = 5 * 1024 * 1024;

type Status =
  | { kind: 'idle' }
  | { kind: 'info'; text: string }
  | { kind: 'ok'; text: string }
  | { kind: 'error'; text: string };

export function ResumeSection() {
  const [library, setLibrary] = useState<ResumeLibrary>(emptyResumeLibrary());
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const lib = await getResumeLibrary();
      if (cancelled) return;
      setLibrary(lib);
      for (const variant of lib.variants) {
        if (variant.extractedText) continue;
        try {
          const text = await extractResumeText(variant);
          if (cancelled) return;
          if (text && !isResumePlaceholder(text)) {
            setLibrary(await updateResumeVariant(variant.id, { extractedText: text }));
          }
        } catch {}
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    if (file.size > MAX_BYTES) {
      setStatus({
        kind: 'error',
        text: `File is ${formatBytes(file.size)}, limit is ${formatBytes(MAX_BYTES)}.`,
      });
      return;
    }
    if (file.type && !ACCEPTED.includes(file.type)) {
      if (!/\.(pdf|docx?|txt)$/i.test(file.name)) {
        setStatus({
          kind: 'error',
          text: `Unsupported type "${file.type}". Allowed: ${ACCEPTED_LABEL}.`,
        });
        return;
      }
    }

    setStatus({ kind: 'info', text: 'Reading file…' });
    try {
      const variant = await fileToResumeVariant(file);
      setLibrary(await addResumeVariant(variant));

      setStatus({ kind: 'info', text: 'Parsing résumé…' });
      let extracted = false;
      try {
        const text = await extractResumeText(variant);
        if (text && !isResumePlaceholder(text)) {
          setLibrary(await updateResumeVariant(variant.id, { extractedText: text }));
          extracted = true;
        }
      } catch {}
      setStatus({
        kind: 'ok',
        text: extracted
          ? `Saved "${variant.label}" locally. Text extracted for Suggest.`
          : `Saved "${variant.label}" locally. Text extraction failed; Suggest will be limited.`,
      });
    } catch (err) {
      setStatus({
        kind: 'error',
        text: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const onRename = async (variant: ResumeVariant, label: string) => {
    const trimmed = label.trim();
    if (!trimmed || trimmed === variant.label) return;
    setLibrary(await updateResumeVariant(variant.id, { label: trimmed }));
  };

  const onMakeDefault = async (id: string) => {
    setLibrary(await setDefaultResume(id));
  };

  const onRemove = async (variant: ResumeVariant) => {
    setLibrary(await removeResumeVariant(variant.id));
    setStatus({ kind: 'info', text: `Removed "${variant.label}".` });
  };

  const active = defaultVariant(library);
  const used = resumeLibraryBytes(library.variants);
  const full = library.variants.length >= MAX_RESUME_VARIANTS;

  return (
    <Section
      title="Resumes"
      hint={`Stored locally in your browser. The default is attached when you click Fill; the popup lets you pick a different one for a company. ${ACCEPTED_LABEL}, up to ${formatBytes(MAX_BYTES)} each, ${MAX_RESUME_VARIANTS} max.`}
    >
      <div className="space-y-3">
        {library.variants.length > 0 && (
          <ul className="space-y-2">
            {library.variants.map((variant) => {
              const isDefault = variant.id === active?.id;
              return (
                <li
                  key={variant.id}
                  className="rounded-md border border-slate-200 bg-white p-3 text-sm dark:border-slate-700 dark:bg-slate-800"
                >
                  <div className="flex items-start gap-2">
                    <input
                      type="radio"
                      name="default-resume"
                      className="mt-1.5"
                      checked={isDefault}
                      onChange={() => void onMakeDefault(variant.id)}
                      aria-label={`Use ${variant.label} by default`}
                    />
                    <div className="min-w-0 flex-1">
                      <input
                        type="text"
                        defaultValue={variant.label}
                        onBlur={(e) => {
                          if (!e.target.value.trim()) e.target.value = variant.label;
                          void onRename(variant, e.target.value);
                        }}
                        aria-label="Resume label"
                        className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 font-medium text-slate-800 hover:border-slate-300 focus:border-sky-500 focus:outline-none dark:text-slate-100 dark:hover:border-slate-600"
                      />
                      <div className="px-1 text-xs text-slate-500 dark:text-slate-400">
                        {variant.filename} · {formatBytes(variant.size)} · uploaded{' '}
                        {new Date(variant.uploadedAt).toLocaleDateString()}
                        {isDefault && (
                          <span className="ml-1 text-emerald-600 dark:text-emerald-400">
                            · default
                          </span>
                        )}
                      </div>
                      {!variant.extractedText && (
                        <div className="px-1 text-xs text-amber-700 dark:text-amber-400">
                          No text extracted; Suggest can&apos;t read this one.
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => void onRemove(variant)}
                      className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                    >
                      Remove
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <div className="flex items-center gap-3">
          <label
            className={
              full
                ? 'inline-flex cursor-not-allowed items-center rounded-md bg-slate-200 px-3 py-1.5 text-xs font-medium text-slate-500 dark:bg-slate-700 dark:text-slate-400'
                : 'inline-flex cursor-pointer items-center rounded-md bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-500'
            }
          >
            {library.variants.length === 0 ? 'Upload resume…' : 'Add another…'}
            <input
              type="file"
              accept={ACCEPTED_LABEL}
              onChange={onPick}
              disabled={full}
              className="hidden"
            />
          </label>
          {library.variants.length > 0 && (
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {library.variants.length} of {MAX_RESUME_VARIANTS} ·{' '}
              {formatBytes(used)} of {formatBytes(RESUME_LIBRARY_BUDGET_BYTES)} used
            </span>
          )}
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
      </div>
    </Section>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
