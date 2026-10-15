import { isStale } from '@/jobs/store';
import { describeCheck } from '@/jobs/summary';
import { progressFractions, type JobCheck, type JobProgress } from '@/jobs/schema';
import { ProgressBar } from '@/ui/ProgressBar';

export function CheckStatus(props: { check: JobCheck | null; now: Date; startError: string | null }) {
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
