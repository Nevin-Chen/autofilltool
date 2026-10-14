import { useState } from 'react';
import { getSettings, setSettings } from '@/profile/store';
import { MAX_JOB_SEARCH_PAGES, type JobFeedSettings, type JobSearch } from '@/profile/schema';
import { sourceForUrl, type JobSource } from '@/jobs/sources';
import { Section } from '@/ui/options/Section';

type SearchDraft = {
  id: string;
  label: string;
  url: string;
  maxPages?: number | null;
  pagesInput?: string;
  active?: boolean;
};

function readsSeveralPages(source: JobSource | null): source is JobSource {
  return !!source && source.limits.searchPages.max > 1;
}

function ActiveSwitch(props: { on: boolean; label: string; onChange: (on: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.on}
      aria-label={`Include ${props.label} in checks`}
      title={props.on ? 'On: included in checks' : 'Off: skipped in checks'}
      onClick={() => props.onChange(!props.on)}
      className={`relative mt-1.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 dark:focus:ring-offset-slate-900 ${
        props.on ? 'bg-sky-600' : 'bg-slate-300 dark:bg-slate-600'
      }`}
    >
      <span
        aria-hidden="true"
        className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${props.on ? 'translate-x-[18px]' : 'translate-x-0.5'}`}
      />
    </button>
  );
}

export function SearchSettings(props: {
  initial: JobFeedSettings;
  onSaved: (settings: JobFeedSettings) => void;
  checkRunning: boolean;
}) {
  const [searches, setSearches] = useState<SearchDraft[]>(() =>
    props.initial.searches.map((search) => ({ ...search, pagesInput: search.maxPages ? String(search.maxPages) : '' })),
  );
  const [saveState, setSaveState] = useState<'idle' | 'saved' | 'error'>('idle');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const updateSearch = (id: string, patch: Partial<SearchDraft>) =>
    setSearches((current) => current.map((s) => (s.id === id ? { ...s, ...patch } : s)));

  const onToggle = async (id: string, active: boolean) => {
    updateSearch(id, { active });
    const fresh = await getSettings();
    if (!fresh.jobs.searches.some((search) => search.id === id)) return;
    const jobs: JobFeedSettings = {
      ...fresh.jobs,
      searches: fresh.jobs.searches.map((search) => (search.id === id ? { ...search, active } : search)),
    };
    await setSettings({ ...fresh, jobs });
    props.onSaved(jobs);
  };

  const onSave = async () => {
    const fresh = await getSettings();
    const nextErrors: Record<string, string> = {};
    const valid: JobSearch[] = [];
    for (const search of searches) {
      const url = search.url.trim();
      if (!url) continue;
      const source = sourceForUrl(url);
      if (!source) {
        nextErrors[search.id] = "This job board isn't supported yet.";
        continue;
      }
      const pagesText = (search.pagesInput ?? '').trim();
      let maxPages: number | null = null;
      if (readsSeveralPages(source) && pagesText) {
        const pages = Number(pagesText);
        if (!Number.isInteger(pages) || pages < 1 || pages > MAX_JOB_SEARCH_PAGES) {
          nextErrors[search.id] = `Pages must be a whole number from 1 to ${MAX_JOB_SEARCH_PAGES}, or empty for the default.`;
          continue;
        }
        maxPages = pages;
      }
      valid.push({ id: search.id, label: search.label.trim(), url, maxPages, active: search.active ?? true });
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      setSaveState('error');
      return;
    }
    const jobs: JobFeedSettings = { ...fresh.jobs, searches: valid };
    await setSettings({ ...fresh, jobs });
    setSearches(valid.map((search) => ({ ...search, pagesInput: search.maxPages ? String(search.maxPages) : '' })));
    props.onSaved(jobs);
    setSaveState('saved');
    setTimeout(() => setSaveState('idle'), 1500);
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800/60">
      <Section
        title="Saved searches"
        hint="Paste the URL of a LinkedIn search with your filters already set: keywords, location, date posted, salary. Turn a search off to skip it in checks; the switch saves right away. Claude judges each job against your profile and default résumé from Settings, and follows the notes you leave when you disagree with a verdict."
        collapsible
        defaultCollapsed={false}
      >
        <div className="space-y-3">
          {searches.map((search) => (
            <div key={search.id}>
              <div className="flex gap-2">
                <ActiveSwitch
                  on={search.active ?? true}
                  label={search.label || 'this search'}
                  onChange={(on) => void onToggle(search.id, on)}
                />
                <input
                  type="text"
                  value={search.label}
                  onChange={(e) => updateSearch(search.id, { label: e.target.value })}
                  placeholder="Label"
                  aria-label="Search label"
                  className={`${search.active === false ? 'opacity-60 ' : ''}w-36 shrink-0 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm shadow-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100`}
                />
                <input
                  type="url"
                  value={search.url}
                  onChange={(e) => updateSearch(search.id, { url: e.target.value })}
                  placeholder="https://www.linkedin.com/jobs/search-results/?keywords=…"
                  aria-label="Search URL"
                  aria-invalid={Boolean(errors[search.id])}
                  className={`${search.active === false ? 'opacity-60 ' : ''}min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm shadow-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100`}
                />
                {readsSeveralPages(sourceForUrl(search.url.trim())) && (
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={MAX_JOB_SEARCH_PAGES}
                    value={search.pagesInput ?? ''}
                    onChange={(e) => updateSearch(search.id, { pagesInput: e.target.value })}
                    placeholder="Pages"
                    aria-label={`Pages to read for ${search.label || 'this search'}`}
                    title="Results pages to read each check. Empty uses the default."
                    className="w-20 shrink-0 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm shadow-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                  />
                )}
                <button
                  type="button"
                  onClick={() => setSearches((current) => current.filter((s) => s.id !== search.id))}
                  aria-label={`Remove ${search.label || 'search'}`}
                  className="rounded-md px-2 text-sm text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200"
                >
                  Remove
                </button>
              </div>
              {errors[search.id] && (
                <p className="mt-1 text-xs text-rose-700 dark:text-rose-300">{errors[search.id]}</p>
              )}
            </div>
          ))}
          {props.checkRunning && (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              A check is running. Switching a search on or off applies to the next check.
            </p>
          )}
          {(() => {
            const paged = searches.map((search) => sourceForUrl(search.url.trim())).find(readsSeveralPages);
            return paged ? (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Pages: how many results pages to read each check, up to {MAX_JOB_SEARCH_PAGES}. Leave it empty for{' '}
                {paged.limits.searchPages.min} to {paged.limits.searchPages.max}, picked at random each check. A check
                also stops early once it has clicked {paged.limits.detailReads.min} to {paged.limits.detailReads.max}{' '}
                jobs.
              </p>
            ) : null;
          })()}
          <button
            type="button"
            onClick={() =>
              setSearches((current) => [...current, { id: crypto.randomUUID(), label: '', url: '', pagesInput: '' }])
            }
            className="rounded-md border border-dashed border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Add search
          </button>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => void onSave()}
              className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
            >
              Save
            </button>
            {saveState === 'saved' && <span className="text-xs text-emerald-600 dark:text-emerald-400">Saved</span>}
            {saveState === 'error' && (
              <span className="text-xs text-rose-700 dark:text-rose-300">Fix the highlighted searches first</span>
            )}
          </div>
        </div>
      </Section>
    </div>
  );
}
