import { useMemo, useState, type ReactNode } from 'react';
import { formatCheckDateTime, formatCheckTime } from '@/jobs/summary';
import { groupByCheck, type CheckGroup } from '@/jobs/groups';
import { removeJobFeedback, saveJobFeedback } from '@/jobs/feedback';
import type {
  DeepReview,
  JobCheck,
  JobFeedback,
  JobVerdict,
  JudgedJob,
  RequirementStatus,
} from '@/jobs/schema';
import type { JobSearch } from '@/profile/schema';

type SearchLabels = ReadonlyMap<string, string>;

export function Results(props: {
  jobs: readonly JudgedJob[];
  checks: readonly JobCheck[];
  now: Date;
  feedback: readonly JobFeedback[];
  searches: readonly JobSearch[];
}) {
  const groups = useMemo(() => groupByCheck(props.jobs, props.checks), [props.jobs, props.checks]);
  const byId = useMemo(() => new Map(props.jobs.map((job) => [job.id, job])), [props.jobs]);
  const feedbackById = useMemo(
    () => new Map(props.feedback.map((entry) => [entry.jobId, entry])),
    [props.feedback],
  );
  const searchLabels = useMemo(() => labelsById(props.searches), [props.searches]);

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
            <JobList
              title="Strong"
              jobs={withVerdict(group.jobs, 'strong')}
              now={props.now}
              feedbackById={feedbackById}
              searchLabels={searchLabels}
            />
            <JobList
              title="Maybe"
              jobs={withVerdict(group.jobs, 'maybe')}
              now={props.now}
              feedbackById={feedbackById}
              searchLabels={searchLabels}
            />
            <CompactList
              title="Skipped"
              jobs={withVerdict(group.jobs, 'skip')}
              describe={(job) => job.reason}
              feedbackById={feedbackById}
              searchLabels={searchLabels}
            />
            <CompactList
              title="Repeats"
              jobs={withVerdict(group.jobs, 'repeat')}
              describe={(job) => repeatNote(job, job.repeatOf ? byId.get(job.repeatOf) : undefined)}
              feedbackById={feedbackById}
              searchLabels={searchLabels}
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
  searchLabels: SearchLabels;
}) {
  if (props.jobs.length === 0) return null;
  return (
    <div>
      <h3 className="mb-2 text-sm font-medium text-slate-600 dark:text-slate-300">
        {props.title} <span className="text-slate-400 dark:text-slate-500">({props.jobs.length})</span>
      </h3>
      <ul className="space-y-2">
        {props.jobs.map((job) => (
          <JobCard
            key={job.id}
            job={job}
            now={props.now}
            feedback={props.feedbackById.get(job.id)}
            searchLabel={searchLabelOf(job, props.searchLabels)}
          />
        ))}
      </ul>
    </div>
  );
}

function JobCard(props: { job: JudgedJob; now: Date; feedback: JobFeedback | undefined; searchLabel: string | undefined }) {
  const { job } = props;
  return (
    <li>
      <details open className="rounded-md border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
        <summary className="block cursor-pointer rounded-md px-3 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-700/60">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <span className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-medium text-slate-900 dark:text-slate-100">{job.title}</span>
              <SearchLabel label={props.searchLabel} />
            </span>
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
        </summary>
        <div className="px-3 pb-3">
          <p className="text-sm text-slate-700 dark:text-slate-200">{job.reason}</p>
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
              <FeedbackControls job={job} feedback={props.feedback} />
            </span>
          </div>
        </div>
      </details>
    </li>
  );
}

function SearchLabel({ label }: { label: string | undefined }) {
  if (!label) return null;
  return (
    <span
      title="Saved search"
      className="rounded border border-slate-200 px-1.5 py-0.5 text-[11px] text-slate-600 dark:border-slate-600 dark:text-slate-300"
    >
      <span className="sr-only">Saved search: </span>
      {label}
    </span>
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
  searchLabels: SearchLabels;
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
            , {job.company}: {props.describe(job)} <SearchLabel label={searchLabelOf(job, props.searchLabels)} />{' '}
            <span className="text-xs">
              <FeedbackControls job={job} feedback={props.feedbackById.get(job.id)} agreeable={false} />
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function labelsById(searches: readonly JobSearch[]): SearchLabels {
  return new Map(
    searches.flatMap((search) => {
      const label = search.label.trim();
      return label ? [[search.id, label] as const] : [];
    }),
  );
}

function searchLabelOf(job: JudgedJob, labels: SearchLabels): string | undefined {
  return job.searchId ? labels.get(job.searchId) : undefined;
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
