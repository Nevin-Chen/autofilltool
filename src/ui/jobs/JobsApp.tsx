import { useEffect, useState } from 'react';
import { sendToBackground } from '@/lib/messaging';
import { getSettings } from '@/profile/store';
import type { JobFeedSettings } from '@/profile/schema';
import { clearJobFeed, emptyJobFeed, getJobFeed, latestCheck, runningCheck, subscribeJobFeed } from '@/jobs/store';
import { agreementStats, getJobFeedback, subscribeJobFeedback } from '@/jobs/feedback';
import type { JobFeed, JobFeedback } from '@/jobs/schema';
import { CheckStatus } from './CheckStatus';
import { SearchSettings } from './SearchSettings';
import { Results } from './Results';

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
            disabled={running !== null || !jobSettings?.searches.some((search) => search.active)}
            className="rounded-md bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-700 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:focus:ring-offset-slate-900"
          >
            {running ? 'Checking…' : 'Check now'}
          </button>
        </div>
      </header>

      <CheckStatus check={check} now={now} startError={startError} />
      <AgreementLine feedback={feedback} />

      {jobSettings && (
        <SearchSettings initial={jobSettings} onSaved={setJobSettings} checkRunning={running !== null} />
      )}

      <Results
        jobs={feed.jobs}
        checks={feed.checks}
        now={now}
        feedback={feedback}
        searches={jobSettings?.searches ?? []}
      />

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

function AgreementLine(props: { feedback: readonly JobFeedback[] }) {
  const { rated, agreed } = agreementStats(props.feedback);
  if (rated === 0) return null;
  return (
    <p className="text-xs text-slate-500 dark:text-slate-400">
      You agreed with {agreed} of the {rated} verdicts you rated. Your disagreements go to Claude on every check.
    </p>
  );
}
