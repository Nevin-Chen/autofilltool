import { JobFeedSchema, type JobCheck, type JobFeed } from './schema';

export const JOB_FEED_KEY = 'jobFeed';
export const JOB_FEED_VERSION = 1;
export const JOB_FEED_RETENTION_DAYS = 7;
export const MAX_JOB_CHECKS = 30;
export const STALE_CHECK_MS = 10 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

export function emptyJobFeed(): JobFeed {
  return { jobs: [], checks: [] };
}

export function parseJobFeed(raw: unknown): JobFeed {
  if (!raw || typeof raw !== 'object') return emptyJobFeed();
  const parsed = JobFeedSchema.safeParse((raw as { data?: unknown }).data);
  return parsed.success ? parsed.data : emptyJobFeed();
}

export async function getJobFeed(): Promise<JobFeed> {
  const got = await chrome.storage.local.get(JOB_FEED_KEY);
  return parseJobFeed(got[JOB_FEED_KEY]);
}

export async function setJobFeed(feed: JobFeed, now: Date = new Date()): Promise<void> {
  await chrome.storage.local.set({
    [JOB_FEED_KEY]: { schemaVersion: JOB_FEED_VERSION, data: pruneJobFeed(feed, now) },
  });
}

export async function updateJobFeed(
  change: (feed: JobFeed) => JobFeed,
  now: Date = new Date(),
): Promise<JobFeed> {
  const next = change(await getJobFeed());
  await setJobFeed(next, now);
  return next;
}

export async function clearJobFeed(): Promise<void> {
  await chrome.storage.local.remove(JOB_FEED_KEY);
}

export function pruneJobFeed(feed: JobFeed, now: Date): JobFeed {
  const cutoff = now.getTime() - JOB_FEED_RETENTION_DAYS * DAY_MS;
  return {
    jobs: feed.jobs.filter((job) => Date.parse(job.judgedAt) >= cutoff),
    checks: feed.checks.slice(-MAX_JOB_CHECKS),
  };
}

export function isStale(check: JobCheck, now: Date): boolean {
  return check.status === 'running' && now.getTime() - Date.parse(check.startedAt) > STALE_CHECK_MS;
}

export function runningCheck(feed: JobFeed, now: Date): JobCheck | null {
  const check = feed.checks.at(-1);
  return check && check.status === 'running' && !isStale(check, now) ? check : null;
}

export function latestCheck(feed: JobFeed): JobCheck | null {
  return feed.checks.at(-1) ?? null;
}

export function subscribeJobFeed(listener: (feed: JobFeed) => void): () => void {
  const handler = (
    changes: { [key: string]: chrome.storage.StorageChange },
    areaName: chrome.storage.AreaName,
  ) => {
    if (areaName !== 'local' || !(JOB_FEED_KEY in changes)) return;
    listener(parseJobFeed(changes[JOB_FEED_KEY]?.newValue));
  };
  chrome.storage.onChanged.addListener(handler);
  return () => chrome.storage.onChanged.removeListener(handler);
}
