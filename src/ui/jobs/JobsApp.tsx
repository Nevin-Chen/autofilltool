import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { sendToBackground } from '@/lib/messaging';
import { getSettings, setSettings } from '@/profile/store';
import { MAX_JOB_SEARCH_PAGES, type JobFeedSettings, type JobSearch } from '@/profile/schema';
import {
  clearJobFeed,
  emptyJobFeed,
  getJobFeed,
  isStale,
  latestCheck,
  runningCheck,
  subscribeJobFeed,
} from '@/jobs/store';
import { describeCheck, formatCheckDateTime, formatCheckTime } from '@/jobs/summary';
import { groupByCheck, type CheckGroup } from '@/jobs/groups';
import { sourceForUrl, type JobSource } from '@/jobs/sources';
import { ProgressBar } from '@/ui/ProgressBar';
import {
  agreementStats,
  getJobFeedback,
  removeJobFeedback,
  saveJobFeedback,
  subscribeJobFeedback,
} from '@/jobs/feedback';
import {
  progressFractions,
  type DeepReview,
  type JobCheck,
  type JobFeed,
  type JobFeedback,
  type JobProgress,
  type JobVerdict,
  type JudgedJob,
  type RequirementStatus,
} from '@/jobs/schema';
import { Section } from '@/ui/options/Section';

export function JobsApp() {
  const [feed, setFeed] = useState<JobFeed>(emptyJobFeed);
  const [jobSettings, setJobSettings] = useState<JobFeedSettings | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [feedback, setFeedback] = useState<JobFeedback[]>([]);

  useEffect(() => {
    void getJobFeedback().then(setFeedback);
    return subscribeJobFeedback(setFeedback);
  }, []);

  useEffect(() => {
    void getJobFeed().then(setFeed);
    void getSettings().then((settings) => setJobSettings(settings.jobs));
    const clearBadge = () => void chrome.action.setBadgeText({ text: '' });
    clearBadge();
    window.addEventListener('focus', clearBadge);
    const unsubscribe = subscribeJobFeed((next) => {
      setFeed(next);
      setNow(new Date());
    });
    const tick = setInterval(() => setNow(new Date()), 30_000);
    return () => {
      unsubscribe();
      clearInterval(tick);
      window.removeEventListener('focus', clearBadge);
    };
  }, []);

  const running = runningCheck(feed, now);
  const check = latestCheck(feed);
  const [stopping, setStopping] = useState(false);
  const stoppable = check?.status === 'running';

  useEffect(() => {
    if (!stoppable) setStopping(false);
  }, [stoppable]);

  const onCheck = async () => {
    setStartError(null);
    const response = await sendToBackground({ type: 'CHECK_JOBS' });
    if (!response.ok) setStartError(response.error);
  };

  const onStop = async () => {
    setStopping(true);
    const response = await sendToBackground({ type: 'STOP_JOBS' });
    if (!response.ok) {
      setStopping(false);
      setStartError(response.error);
    }
  };

  const onClear = async () => {
    await clearJobFeed();
    setConfirmingClear(false);
  };

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6 text-slate-900 dark:text-slate-100">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Job feed</h1>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
            New postings from today on your saved searches, sorted by Claude against your résumé.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          {stoppable && (
            <button
              type="button"
              onClick={() => void onStop()}
              disabled={stopping}
              className="rounded-md border border-rose-300 px-3 py-1.5 text-sm font-medium text-rose-700 hover:bg-rose-50 focus:outline-none focus:ring-2 focus:ring-rose-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:border-rose-800 dark:text-rose-300 dark:hover:bg-rose-950/40 dark:focus:ring-offset-slate-900"
            >
              {stopping ? 'Stopping…' : 'Stop'}
            </button>
          )}
          <button
            type="button"
            onClick={() => void onCheck()}
            disabled={running !== null || !jobSettings?.searches.length}
            className="rounded-md bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-700 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:focus:ring-offset-slate-900"
          >
            {running ? 'Checking…' : 'Check now'}
          </button>
        </div>
      </header>

      <CheckStatus check={check} now={now} startError={startError} />
      <AgreementLine feedback={feedback} />

      {jobSettings && (
        <SearchSettings
          initial={jobSettings}
          onSaved={setJobSettings}
          defaultCollapsed={jobSettings.searches.length > 0}
        />
      )}

      <Results jobs={feed.jobs} checks={feed.checks} now={now} feedback={feedback} />

      {feed.jobs.length > 0 && (
        <div className="flex justify-end gap-2 text-xs">
          {confirmingClear ? (
            <>
              <button
                type="button"
                onClick={() => void onClear()}
                className="rounded bg-rose-50 px-2 py-1 text-rose-700 hover:bg-rose-100 dark:bg-rose-900/30 dark:text-rose-300 dark:hover:bg-rose-900/50"
              >
                Confirm clear
              </button>
              <button
                type="button"
                onClick={() => setConfirmingClear(false)}
                className="rounded px-2 py-1 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingClear(true)}
              className="rounded px-2 py-1 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              Clear results
            </button>
          )}
        </div>
      )}
    </main>
  );
}

function CheckStatus(props: { check: JobCheck | null; now: Date; startError: string | null }) {
  const { check, now, startError } = props;
  const failed = check?.status === 'failed';
  const interrupted = check !== null && isStale(check, now);
  const counts = check?.status === 'ok' || check?.status === 'stopped' ? check.counts : null;
  return (
    <div className="space-y-2">
      <p className="text-sm text-slate-600 dark:text-slate-300" aria-live="polite">
        {check?.status === 'running' && !interrupted && (
          <span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-sky-500 align-middle" aria-hidden="true" />
        )}
        {describeCheck(check, now)}
      </p>
      {check?.status === 'running' && !interrupted && check.progress && <CheckProgress progress={check.progress} />}
      {counts && (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {counts.postedToday} recent listings on your searches · {counts.alreadySeen} already judged ·{' '}
          {counts.identicalRepeats} identical repeats dropped · {counts.reviewed} read in full by Claude
          {counts.summaryOnly > 0 && ` (${counts.summaryOnly} from the board's summary only, the posting page didn't load)`}
          {counts.unreadCards > 0 &&
            ` · ${counts.unreadCards} job cards hadn't finished loading in the background tab and were skipped`}
          {counts.deferred > 0 &&
            ` · ${counts.deferred} left for the next check because this check reached its click limit or hit a security check`}
          {counts.unjudged > 0 &&
            ` · ${counts.unjudged} got no verdict from Claude and will be judged on the next check`}
        </p>
      )}
      {(failed || interrupted || startError) && (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
          {startError ??
            (interrupted
              ? 'The last check stopped partway, likely because the extension restarted. Check again.'
              : check?.error)}
        </div>
      )}
    </div>
  );
}

function CheckProgress({ progress }: { progress: JobProgress }) {
  const { browsing, reviews } = progressFractions(progress);
  const allPagesRead = progress.pagesDone >= progress.pagesPlanned;
  const browsingDetail = allPagesRead
    ? 'All pages read'
    : [
        `Page ${progress.pagesDone + 1} of ${progress.pagesPlanned}`,
        progress.pageJobsTotal > 0 ? `job ${progress.pageJobsDone} of ${progress.pageJobsTotal} on this page` : '',
      ]
        .filter(Boolean)
        .join(' · ');
  return (
    <div className="space-y-2 rounded-md border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800/60">
      <ProgressBar label="Reading results" detail={browsingDetail} fraction={browsing} />
      {reviews !== null && (
        <ProgressBar
          label="Claude reviews"
          detail={`${progress.reviewsDone} of ${progress.reviewsQueued} done`}
          fraction={reviews}
        />
      )}
    </div>
  );
}

type SearchDraft = { id: string; label: string; url: string; maxPages?: number | null; pagesInput?: string };

function readsSeveralPages(source: JobSource | null): source is JobSource {
  return !!source && source.limits.searchPages.max > 1;
}

function SearchSettings(props: {
  initial: JobFeedSettings;
  onSaved: (settings: JobFeedSettings) => void;
  defaultCollapsed: boolean;
}) {
  const [searches, setSearches] = useState<SearchDraft[]>(() =>
    props.initial.searches.map((search) => ({ ...search, pagesInput: search.maxPages ? String(search.maxPages) : '' })),
  );
  const [criteria, setCriteria] = useState(props.initial.criteria);
  const [saveState, setSaveState] = useState<'idle' | 'saved' | 'error'>('idle');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const updateSearch = (id: string, patch: Partial<SearchDraft>) =>
    setSearches((current) => current.map((s) => (s.id === id ? { ...s, ...patch } : s)));

  const onSave = async () => {
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
      valid.push({ id: search.id, label: search.label.trim(), url, maxPages });
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      setSaveState('error');
      return;
    }
    const jobs: JobFeedSettings = { searches: valid, criteria };
    const fresh = await getSettings();
    await setSettings({ ...fresh, jobs });
    setSearches(valid.map((search) => ({ ...search, pagesInput: search.maxPages ? String(search.maxPages) : '' })));
    props.onSaved(jobs);
    setSaveState('saved');
    setTimeout(() => setSaveState('idle'), 1500);
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800/60">
      <Section
        title="Searches and criteria"
        hint="Paste the URL of a LinkedIn search with your filters already set: keywords, location, date posted, salary."
        collapsible
        defaultCollapsed={props.defaultCollapsed}
      >
        <div className="space-y-3">
          {searches.map((search) => (
            <div key={search.id}>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={search.label}
                  onChange={(e) => updateSearch(search.id, { label: e.target.value })}
                  placeholder="Label"
                  aria-label="Search label"
                  className="w-36 shrink-0 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm shadow-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                />
                <input
                  type="url"
                  value={search.url}
                  onChange={(e) => updateSearch(search.id, { url: e.target.value })}
                  placeholder="https://www.linkedin.com/jobs/search-results/?keywords=…"
                  aria-label="Search URL"
                  aria-invalid={Boolean(errors[search.id])}
                  className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm shadow-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
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

          <label className="block text-sm">
            <span className="mb-1 block text-slate-700 dark:text-slate-200">What makes a job a fit</span>
            <textarea
              value={criteria}
              onChange={(e) => setCriteria(e.target.value)}
              rows={5}
              placeholder="For example: TypeScript or Ruby web roles asking 0 to 3 years. Remote or NYC preferred. Skip non-software roles like QA, IT support or field engineering."
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            />
            <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">
              Claude also reads your profile and your default résumé from Settings.
            </span>
          </label>

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

function AgreementLine(props: { feedback: readonly JobFeedback[] }) {
  const { rated, agreed } = agreementStats(props.feedback);
  if (rated === 0) return null;
  return (
    <p className="text-xs text-slate-500 dark:text-slate-400">
      You agreed with {agreed} of the {rated} verdicts you rated. Your disagreements go to Claude on every check.
    </p>
  );
}

function Results(props: {
  jobs: readonly JudgedJob[];
  checks: readonly JobCheck[];
  now: Date;
  feedback: readonly JobFeedback[];
}) {
  const groups = useMemo(() => groupByCheck(props.jobs, props.checks), [props.jobs, props.checks]);
  const byId = useMemo(() => new Map(props.jobs.map((job) => [job.id, job])), [props.jobs]);
  const feedbackById = useMemo(
    () => new Map(props.feedback.map((entry) => [entry.jobId, entry])),
    [props.feedback],
  );

  if (props.jobs.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
        No results yet. Add a saved search, then click Check now.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {groups.map((group, index) => (
        <details
          key={group.checkId}
          open={index === 0}
          className="rounded-lg border border-slate-200 bg-white/60 dark:border-slate-700 dark:bg-slate-800/40"
        >
          <summary className="flex cursor-pointer flex-wrap items-baseline gap-x-3 gap-y-1 rounded-lg px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/80">
            <h2 className="text-base font-semibold">{formatCheckDateTime(group.startedAt, props.now)}</h2>
            <span className="text-sm text-slate-500 dark:text-slate-400">{tallyLine(group.tally)}</span>
            {group.status && group.status !== 'ok' && <CheckStatusChip status={group.status} />}
          </summary>
          <div className="space-y-4 px-4 pb-4 pt-1">
            <JobList title="Strong" jobs={withVerdict(group.jobs, 'strong')} now={props.now} feedbackById={feedbackById} />
            <JobList title="Maybe" jobs={withVerdict(group.jobs, 'maybe')} now={props.now} feedbackById={feedbackById} />
            <CompactList
              title="Skipped"
              jobs={withVerdict(group.jobs, 'skip')}
              describe={(job) => job.reason}
              feedbackById={feedbackById}
            />
            <CompactList
              title="Repeats"
              jobs={withVerdict(group.jobs, 'repeat')}
              describe={(job) => repeatNote(job, job.repeatOf ? byId.get(job.repeatOf) : undefined)}
              feedbackById={feedbackById}
            />
          </div>
        </details>
      ))}
    </div>
  );
}

function JobList(props: {
  title: string;
  jobs: JudgedJob[];
  now: Date;
  feedbackById: ReadonlyMap<string, JobFeedback>;
}) {
  if (props.jobs.length === 0) return null;
  return (
    <div>
      <h3 className="mb-2 text-sm font-medium text-slate-600 dark:text-slate-300">
        {props.title} <span className="text-slate-400 dark:text-slate-500">({props.jobs.length})</span>
      </h3>
      <ul className="space-y-2">
        {props.jobs.map((job) => (
          <li
            key={job.id}
            className="rounded-md border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <a
                href={job.listingUrl}
                target="_blank"
                rel="noreferrer"
                className="font-medium text-slate-900 hover:underline dark:text-slate-100"
              >
                {job.title}
              </a>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                posted {formatCheckTime(job.postedAt, props.now)}
              </span>
            </div>
            <div className="mt-0.5 text-xs text-slate-600 dark:text-slate-300">
              {jobFacts(job)}
              {job.easyApply && (
                <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                  Easy Apply, on the job board (autofill can&apos;t help)
                </span>
              )}
            </div>
            <p className="mt-1.5 text-sm text-slate-700 dark:text-slate-200">{job.reason}</p>
            {job.review && <ReviewDetails review={job.review} />}
            <div className="mt-2 flex flex-wrap items-center gap-4 text-xs">
              <a href={job.listingUrl} target="_blank" rel="noreferrer" className="text-sky-700 hover:underline dark:text-sky-400">
                Job page
              </a>
              {job.applyUrl && (
                <a href={job.applyUrl} target="_blank" rel="noreferrer" className="text-sky-700 hover:underline dark:text-sky-400">
                  Apply directly
                </a>
              )}
              <span className="ml-auto">
                <FeedbackControls job={job} feedback={props.feedbackById.get(job.id)} />
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ReviewDetails({ review }: { review: DeepReview }) {
  const mustHaves = review.requirements.filter((r) => r.importance === 'must');
  const met = mustHaves.filter((r) => r.status === 'met').length;
  return (
    <div className="mt-2 space-y-2">
      <div className="flex flex-wrap gap-1.5">
        <Chip>{review.confidence} confidence</Chip>
        {mustHaves.length > 0 && (
          <Chip>
            {met} of {mustHaves.length} required met
          </Chip>
        )}
        {review.descriptionSource === 'summary' && <Chip tone="warn">Board summary only</Chip>}
        {review.flags.map((flag) => (
          <Chip key={flag} tone="warn">
            {flag}
          </Chip>
        ))}
      </div>
      {review.demotedForUnverifiedEvidence && (
        <p className="rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          Claude rated this strong, but some résumé lines it quoted aren&apos;t in your résumé text, so it moved to Maybe.
          Check the quotes marked below.
        </p>
      )}
      {review.requirements.length > 0 && (
        <details>
          <summary className="cursor-pointer text-xs font-medium text-sky-700 hover:underline dark:text-sky-400">
            Why: {review.requirements.length} requirements checked against your résumé
          </summary>
          <ul className="mt-2 space-y-1.5">
            {review.requirements.map((requirement, index) => (
              <li key={index} className="flex gap-2 text-xs">
                <StatusMark status={requirement.status} />
                <div className="min-w-0">
                  <span className="text-slate-800 dark:text-slate-100">{requirement.text}</span>
                  <span className="ml-1.5 text-slate-400 dark:text-slate-500">
                    {requirement.importance === 'must' ? 'required' : 'nice to have'}
                  </span>
                  {requirement.evidence && (
                    <div className="text-slate-500 dark:text-slate-400">
                      <span className="italic">“{requirement.evidence}”</span>
                      {!requirement.verified && requirement.status !== 'missing' && (
                        <span className="ml-1.5 text-amber-700 dark:text-amber-400">not found in your résumé text</span>
                      )}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

const STATUS_MARKS: Record<RequirementStatus, { mark: string; label: string; className: string }> = {
  met: { mark: '✓', label: 'Met', className: 'text-emerald-600 dark:text-emerald-400' },
  partial: { mark: '~', label: 'Partly met', className: 'text-amber-600 dark:text-amber-400' },
  missing: { mark: '✗', label: 'Missing', className: 'text-rose-600 dark:text-rose-400' },
};

function StatusMark({ status }: { status: RequirementStatus }) {
  const { mark, label, className } = STATUS_MARKS[status];
  return (
    <span className={`w-3 shrink-0 font-semibold ${className}`}>
      <span aria-hidden="true">{mark}</span>
      <span className="sr-only">{label}:</span>
    </span>
  );
}

function Chip(props: { children: ReactNode; tone?: 'neutral' | 'warn' }) {
  const tone =
    props.tone === 'warn'
      ? 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
      : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300';
  return <span className={`rounded px-1.5 py-0.5 text-[11px] ${tone}`}>{props.children}</span>;
}

function FeedbackControls(props: { job: JudgedJob; feedback: JobFeedback | undefined; agreeable?: boolean }) {
  const { job, feedback } = props;
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState('');

  const save = async (agree: boolean, text = '') => {
    await saveJobFeedback({
      jobId: job.id,
      agree,
      note: text.trim(),
      at: new Date().toISOString(),
      title: job.title,
      company: job.company,
      verdict: job.verdict,
    });
    setEditing(false);
    setNote('');
  };

  if (editing) {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save(false, note);
        }}
        className="flex items-center gap-2"
      >
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="What did Claude get wrong?"
          aria-label={`What Claude got wrong about ${job.title}`}
          autoFocus
          className="w-64 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
        />
        <button type="submit" className="rounded px-2 py-1 font-medium text-sky-700 hover:bg-sky-50 dark:text-sky-400 dark:hover:bg-slate-700">
          Save
        </button>
        <button type="button" onClick={() => setEditing(false)} className="rounded px-2 py-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700">
          Cancel
        </button>
      </form>
    );
  }

  if (feedback) {
    return (
      <span className="text-slate-500 dark:text-slate-400">
        {feedback.agree ? 'You agreed' : `You disagreed${feedback.note ? `: ${feedback.note}` : ''}`}
        {' · '}
        <button type="button" onClick={() => void removeJobFeedback(job.id)} className="underline hover:text-slate-700 dark:hover:text-slate-200">
          Undo
        </button>
      </span>
    );
  }

  return (
    <span className="flex gap-1">
      {props.agreeable !== false && (
        <button type="button" onClick={() => void save(true)} className="rounded px-2 py-1 text-slate-600 hover:bg-emerald-50 hover:text-emerald-700 dark:text-slate-300 dark:hover:bg-slate-700">
          Agree
        </button>
      )}
      <button type="button" onClick={() => setEditing(true)} className="rounded px-2 py-1 text-slate-600 hover:bg-rose-50 hover:text-rose-700 dark:text-slate-300 dark:hover:bg-slate-700">
        Disagree
      </button>
    </span>
  );
}

function CompactList(props: {
  title: string;
  jobs: JudgedJob[];
  describe: (job: JudgedJob) => string;
  feedbackById: ReadonlyMap<string, JobFeedback>;
}) {
  if (props.jobs.length === 0) return null;
  return (
    <details className="group">
      <summary className="cursor-pointer text-sm font-medium text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-100">
        {props.title} <span className="text-slate-400 dark:text-slate-500">({props.jobs.length})</span>
      </summary>
      <ul className="mt-2 space-y-1 text-sm">
        {props.jobs.map((job) => (
          <li key={job.id} className="text-slate-600 dark:text-slate-300">
            <a href={job.listingUrl} target="_blank" rel="noreferrer" className="text-slate-800 hover:underline dark:text-slate-100">
              {job.title}
            </a>
            , {job.company}: {props.describe(job)}{' '}
            <span className="text-xs">
              <FeedbackControls job={job} feedback={props.feedbackById.get(job.id)} agreeable={false} />
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function jobFacts(job: JudgedJob): string {
  const place = job.workplace ? `${job.location} (${job.workplace})` : job.location;
  const years = job.minYoe === null ? 'yrs not listed' : `${job.minYoe}+ yrs`;
  return [job.company, place, job.pay ?? 'pay not listed', years].filter(Boolean).join(' · ');
}

function repeatNote(job: JudgedJob, original: JudgedJob | undefined): string {
  const same = original ? `same role as the ${original.location || 'other'} listing` : 'same role as an earlier listing';
  return job.reason ? `${same}. ${job.reason}` : same;
}

function withVerdict(jobs: readonly JudgedJob[], verdict: JobVerdict): JudgedJob[] {
  return jobs
    .filter((job) => job.verdict === verdict)
    .sort((a, b) => Date.parse(b.postedAt) - Date.parse(a.postedAt));
}

function tallyLine(tally: CheckGroup['tally']): string {
  const parts = [
    tally.strong > 0 ? `${tally.strong} strong` : '',
    tally.maybe > 0 ? `${tally.maybe} maybe` : '',
    tally.skip > 0 ? `${tally.skip} skipped` : '',
    tally.repeat > 0 ? `${tally.repeat} repeat${tally.repeat === 1 ? '' : 's'}` : '',
  ].filter(Boolean);
  return parts.join(' · ') || 'nothing judged';
}

const STATUS_CHIPS: Record<Exclude<JobCheck['status'], 'ok'>, { label: string; className: string }> = {
  running: { label: 'In progress', className: 'bg-sky-50 text-sky-800 dark:bg-sky-950/40 dark:text-sky-300' },
  stopped: { label: 'Stopped', className: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200' },
  failed: { label: 'Failed', className: 'bg-rose-50 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300' },
};

function CheckStatusChip({ status }: { status: Exclude<JobCheck['status'], 'ok'> }) {
  const { label, className } = STATUS_CHIPS[status];
  return <span className={`rounded px-1.5 py-0.5 text-[11px] ${className}`}>{label}</span>;
}
