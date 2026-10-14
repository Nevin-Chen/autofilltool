import { getProfile, getResumeLibrary, getSettings } from '@/profile/store';
import { defaultVariant } from '@/profile/resume-select';
import type { JobSearch, Settings } from '@/profile/schema';
import { extractResumeText, summarizeProfileForClassifier } from '@/ai/client';
import {
  CLAUDE_BRIDGE_DEFAULT_BASE,
  resolveOriginForPermission,
  streamClaudeBridge,
} from '@/ai/providers/claude-bridge';
import { hasOriginPermission } from '@/lib/permissions';
import { sourceForUrl, type BrowsingLimits, type JobSource, type ListingDetails, type Range } from '@/jobs/sources';
import { localDateKey, selectNewListings, type JudgeCandidate, type SeenListing } from '@/jobs/dedupe';
import type { CandidateContext } from '@/jobs/candidate';
import {
  JOB_SCREEN_BATCH_SIZE,
  JOB_SCREEN_MAX_TOKENS,
  JOB_SCREEN_MODEL,
  buildScreenPrompt,
  parseScreenResponse,
  type ScreenResult,
} from '@/jobs/screen';
import {
  JOB_REVIEW_CONCURRENCY,
  JOB_REVIEW_MAX_TOKENS,
  JOB_REVIEW_MODEL,
  MIN_FULL_DESCRIPTION_CHARS,
  buildReviewPrompt,
  finalizeReview,
  parseReviewResponse,
} from '@/jobs/review';
import { getJobFeedback, recentDisagreements } from '@/jobs/feedback';
import { getJobFeed, updateJobFeed } from '@/jobs/store';
import {
  emptyJobCounts,
  emptyJobProgress,
  type DeepReview,
  type JobCheck,
  type JobCheckCounts,
  type JobFeed,
  type JobListing,
  type JudgedJob,
} from '@/jobs/schema';

export const TAB_LOAD_TIMEOUT_MS = 30_000;
export const STOP_GRACE_MS = 2_000;

type Prompt = { system: string; user: string };

export type BrowsingSession = {
  open: (url: string, read: () => unknown) => Promise<unknown>;
  run: (func: (listingId: string) => unknown, listingId: string) => Promise<unknown>;
  close: () => Promise<void>;
};

export type JobCheckDeps = {
  sourceForUrl: (url: string) => JobSource | null;
  openSession: () => BrowsingSession;
  readListingPage: (url: string, source: JobSource) => Promise<unknown>;
  screenBatch: (prompt: Prompt, endpoint: string, signal?: AbortSignal) => Promise<string>;
  reviewJob: (prompt: Prompt, endpoint: string, signal?: AbortSignal) => Promise<string>;
  canReachBridge: (endpoint: string) => Promise<boolean>;
  setBadge: (fits: number) => Promise<void>;
  sleep: (ms: number) => Promise<void>;
  random: () => number;
  now: () => Date;
  newId: () => string;
};

export const defaultJobCheckDeps: JobCheckDeps = {
  sourceForUrl,
  openSession: backgroundTabSession,
  readListingPage: async (url, source) => {
    if (!source.readListingPage) return null;
    const session = backgroundTabSession();
    try {
      return await session.open(url, source.readListingPage);
    } finally {
      await session.close();
    }
  },
  screenBatch: (prompt, endpoint, signal) => askBridge(prompt, endpoint, JOB_SCREEN_MODEL, JOB_SCREEN_MAX_TOKENS, signal),
  reviewJob: (prompt, endpoint, signal) => askBridge(prompt, endpoint, JOB_REVIEW_MODEL, JOB_REVIEW_MAX_TOKENS, signal),
  canReachBridge: (endpoint) => hasOriginPermission(endpoint),
  setBadge: showFitsOnBadge,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  random: Math.random,
  now: () => new Date(),
  newId: () => crypto.randomUUID(),
};

export type Pacer = <T>(kind: 'load' | 'click', task: () => Promise<T>) => Promise<T>;

export class CheckStopped extends Error {
  constructor() {
    super('The check was stopped.');
  }
}

export function untilStopped<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return promise;
  promise.catch(() => {});
  if (signal.aborted) return Promise.reject(new CheckStopped());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new CheckStopped());
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (err: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      },
    );
  });
}

export async function runJobCheck(
  deps: JobCheckDeps = defaultJobCheckDeps,
  signal?: AbortSignal,
): Promise<JobCheck> {
  const checkId = deps.newId();
  const guard = <T>(promise: Promise<T>) => untilStopped(promise, signal);
  const throwIfStopped = () => {
    if (signal?.aborted) throw new CheckStopped();
  };
  const writeFeed = serializedWriter(deps.now);
  await writeFeed((feed) => ({
    ...feed,
    checks: [
      ...feed.checks,
      {
        id: checkId,
        startedAt: deps.now().toISOString(),
        finishedAt: null,
        status: 'running',
        phase: 'Starting',
        error: null,
        counts: null,
        progress: null,
      },
    ],
  }));
  const patchCheck = (patch: Partial<JobCheck>) =>
    writeFeed((feed) => ({
      ...feed,
      checks: feed.checks.map((check) => (check.id === checkId ? { ...check, ...patch } : check)),
    }));
  const storeJobs = async (jobs: JudgedJob[]) => {
    if (jobs.length > 0) await writeFeed((feed) => ({ ...feed, jobs: [...feed.jobs, ...jobs] }));
  };

  const budgets = new Map<string, { searchPages: number; detailReads: number }>();
  const budgetFor = (source: JobSource) => {
    let budget = budgets.get(source.id);
    if (!budget) {
      budget = {
        searchPages: pickInRange(source.limits.searchPages, deps.random),
        detailReads: pickInRange(source.limits.detailReads, deps.random),
      };
      budgets.set(source.id, budget);
    }
    return budget;
  };

  const pacers = new Map<string, Pacer>();
  const paceFor = (source: JobSource): Pacer => {
    let pacer = pacers.get(source.id);
    if (!pacer) {
      pacer = createPacer(source.limits, deps.sleep, deps.random);
      pacers.set(source.id, pacer);
    }
    return pacer;
  };

  const counts = emptyJobCounts();
  const reviews: Promise<void>[] = [];
  let lastReviewError: unknown = null;
  try {
    const [settings, profile, library, feedback, feed] = await Promise.all([
      getSettings(),
      getProfile(),
      getResumeLibrary(),
      getJobFeedback(),
      getJobFeed(),
    ]);
    const searches = settings.jobs.searches;
    if (searches.length === 0) throw new Error('Add a saved search on the Jobs page first.');
    const endpoint = bridgeEndpoint(settings);
    if (!(await deps.canReachBridge(endpoint))) {
      throw new Error(`No permission to reach the Claude bridge at ${endpoint}. Grant it in Options > AI.`);
    }

    const resume = defaultVariant(library);
    const context: CandidateContext = {
      profileSummary: summarizeProfileForClassifier(profile),
      resumeText: resume ? await extractResumeText(resume) : '',
      criteria: settings.jobs.criteria,
      disagreements: recentDisagreements(feedback),
    };
    const today = localDateKey(deps.now());
    const seen: SeenListing[] = [...feed.jobs];
    const detailReadsLeft = new Map<string, number>();
    const progress = emptyJobProgress();
    const reportProgress = () => patchCheck({ progress: { ...progress } });
    const pageBudget = (search: JobSearch, source: JobSource) => search.maxPages ?? budgetFor(source).searchPages;
    for (const search of searches) {
      const source = deps.sourceForUrl(search.url);
      if (source) progress.pagesPlanned += pageBudget(search, source);
    }
    await reportProgress();
    const reviewSlots = createLimiter(JOB_REVIEW_CONCURRENCY);

    const queueReview = (candidate: JudgeCandidate, details: ListingDetails | null) => {
      progress.reviewsQueued++;
      void reportProgress();
      reviews.push(
        reviewSlots(async () => {
          if (signal?.aborted) return;
          try {
            const job = await reviewCandidate(candidate, details, context, endpoint, checkId, deps, signal);
            if (!job) {
              counts.unjudged++;
              return;
            }
            tally(counts, [job]);
            counts.reviewed++;
            progress.reviewsDone++;
            void reportProgress();
            if (job.review?.descriptionSource === 'summary') counts.summaryOnly++;
            await storeJobs([job]);
          } catch (err) {
            if (signal?.aborted) return;
            counts.unjudged++;
            lastReviewError = err;
          }
        }),
      );
    };

    const screenCandidates = async (
      candidates: JudgeCandidate[],
      where: string,
    ): Promise<JudgeCandidate[]> => {
      const advanced: JudgeCandidate[] = [];
      for (let start = 0; start < candidates.length; start += JOB_SCREEN_BATCH_SIZE) {
        const batch = candidates.slice(start, start + JOB_SCREEN_BATCH_SIZE);
        throwIfStopped();
        await patchCheck({ phase: `Screening ${batch.length} new listings from ${where}` });
        const results = parseScreenResponse(
          await guard(deps.screenBatch(buildScreenPrompt(batch, context), endpoint, signal)),
        );
        const judgedAt = deps.now().toISOString();
        const settled: JudgedJob[] = [];
        for (const candidate of batch) {
          const result = results.get(candidate.listing.id);
          if (!result) counts.unjudged++;
          else if (result.verdict === 'review') advanced.push(candidate);
          else settled.push(toScreenedJob(candidate, result, checkId, judgedAt));
        }
        tally(counts, settled);
        await storeJobs(settled);
      }
      return advanced;
    };

    const readDetailsInOrder = async (
      advanced: JudgeCandidate[],
      source: JobSource,
      session: BrowsingSession,
      pace: Pacer,
      where: string,
    ): Promise<void> => {
      const newestFirst = [...advanced].sort((a, b) => Date.parse(b.listing.postedAt) - Date.parse(a.listing.postedAt));
      progress.pageJobsTotal = newestFirst.length;
      progress.pageJobsDone = 0;
      for (const [index, candidate] of newestFirst.entries()) {
        throwIfStopped();
        const left = detailReadsLeft.get(source.id) ?? budgetFor(source).detailReads;
        const needsPage = !!(source.readSelected || source.readListingPage) && !!source.toDetails;
        if (needsPage && left <= 0) {
          counts.deferred += newestFirst.length - index;
          return;
        }
        if (needsPage) {
          detailReadsLeft.set(source.id, left - 1);
          await patchCheck({ phase: `Opening job ${index + 1} of ${newestFirst.length} on ${where}` });
        }
        const details = await readDetails(candidate.listing, source, session, pace);
        if (details === 'blocked') {
          counts.deferred += newestFirst.length - index;
          throw new Error(
            'A job showed a security check or sign-in page, so the check stopped browsing that board. Open it in a tab yourself and deal with it there, then check again.',
          );
        }
        queueReview(candidate, details);
        progress.pageJobsDone++;
      }
    };

    const readDetails = async (
      listing: JobListing,
      source: JobSource,
      session: BrowsingSession,
      pace: Pacer,
    ): Promise<ListingDetails | null | 'blocked'> => {
      if (!source.toDetails) return null;
      if (source.readSelected) {
        const select = source.readSelected;
        const raw = await guard(pace('click', () => session.run(select, listing.id).catch(() => null)));
        if (source.isBlocked(raw)) return 'blocked';
        const details = source.toDetails(raw);
        if (details) return details;
      }
      if (!source.readListingPage || !listing.listingUrl) return null;
      const raw = await guard(pace('load', () => deps.readListingPage(listing.listingUrl, source).catch(() => null)));
      if (source.isBlocked(raw)) return 'blocked';
      return source.toDetails(raw);
    };

    for (const search of searches) {
      const source = deps.sourceForUrl(search.url);
      if (!source) throw new Error(`${searchName(search)} isn't on a supported job board yet.`);
      const pace = paceFor(source);
      const session = deps.openSession();
      try {
        const budget = pageBudget(search, source);
        let pagesRead = 0;
        for (let page = 0; page < budget; page++) {
          const where = page === 0 ? searchName(search) : `${searchName(search)}, page ${page + 1}`;
          throwIfStopped();
          await patchCheck({ phase: `Reading ${where}` });
          const raw = await guard(
            pace('load', () => session.open(source.searchPageUrl(search.url, page), source.readPage)),
          );
          if (source.isBlocked(raw)) {
            throw new Error(
              `${searchName(search)} showed a security check or sign-in page. Open it in a tab yourself and deal with it there, then check again.`,
            );
          }
          const found = source.toListings(raw);
          if (!found) {
            if (page === 0) {
              throw new Error(
                `Couldn't read ${searchName(search)}. If the job board is showing a bot check, open the search in a tab yourself, then check again.`,
              );
            }
            break;
          }
          counts.unreadCards += source.unreadCards?.(raw) ?? 0;

          const selection = selectNewListings(found, seen, today, () => source.postedTodayOnly);
          counts.postedToday += selection.postedToday;
          counts.alreadySeen += selection.alreadySeen;
          counts.identicalRepeats += selection.identicalRepeats;
          seen.push(...selection.candidates.map(({ listing, fingerprint }) => ({ ...listing, fingerprint })));

          const advanced = await screenCandidates(selection.candidates, where);
          await readDetailsInOrder(advanced, source, session, pace, where);
          pagesRead++;
          progress.pagesDone++;
          progress.pageJobsDone = 0;
          progress.pageJobsTotal = 0;
          await reportProgress();

          const clickLimitReached = (detailReadsLeft.get(source.id) ?? 1) <= 0;
          if (found.length === 0 || !source.hasMorePages(raw) || clickLimitReached) break;
        }
        progress.pagesPlanned -= budget - pagesRead;
        await reportProgress();
      } finally {
        await session.close();
      }
    }

    throwIfStopped();
    if (reviews.length > 0) await patchCheck({ phase: `Claude is finishing ${reviews.length} reviews` });
    await guard(Promise.all(reviews));
    throwIfStopped();
    if (reviews.length > 0 && counts.reviewed === 0 && lastReviewError) throw lastReviewError;

    const done = await patchCheck({ status: 'ok', phase: '', finishedAt: deps.now().toISOString(), counts });
    await deps.setBadge(counts.strong + counts.maybe);
    return checkById(done, checkId);
  } catch (err) {
    if (err instanceof CheckStopped || signal?.aborted) {
      await Promise.race([Promise.all(reviews), deps.sleep(STOP_GRACE_MS)]);
      const stopped = await patchCheck({
        status: 'stopped',
        phase: '',
        finishedAt: deps.now().toISOString(),
        error: null,
        counts,
      });
      await deps.setBadge(counts.strong + counts.maybe);
      return checkById(stopped, checkId);
    }
    await Promise.all(reviews);
    const failed = await patchCheck({
      status: 'failed',
      phase: '',
      finishedAt: deps.now().toISOString(),
      error: err instanceof Error ? err.message : String(err),
      counts,
    });
    return checkById(failed, checkId);
  }
}

async function reviewCandidate(
  candidate: JudgeCandidate,
  details: ListingDetails | null,
  context: CandidateContext,
  endpoint: string,
  checkId: string,
  deps: JobCheckDeps,
  signal?: AbortSignal,
): Promise<JudgedJob | null> {
  const listing: JobListing = {
    ...candidate.listing,
    postedAt: details?.postedAt ?? candidate.listing.postedAt,
    applyUrl: details?.applyUrl ?? candidate.listing.applyUrl,
    easyApply: candidate.listing.easyApply || (details?.easyApply ?? false),
  };
  const fullDescription =
    details?.description && details.description.length >= MIN_FULL_DESCRIPTION_CHARS ? details.description : null;
  const description = fullDescription ?? (listing.requirements.trim() || null);
  if (!description) return null;
  const descriptionSource: DeepReview['descriptionSource'] = fullDescription ? 'full' : 'summary';
  const raw = parseReviewResponse(
    await deps.reviewJob(buildReviewPrompt({ listing, description, descriptionSource }, context), endpoint, signal),
  );
  if (!raw) return null;
  const { verdict, review } = finalizeReview(
    raw,
    `${context.resumeText}\n${context.profileSummary}`,
    descriptionSource,
  );
  return {
    ...listing,
    fingerprint: candidate.fingerprint,
    verdict,
    reason: review.summary,
    repeatOf: null,
    checkId,
    judgedAt: deps.now().toISOString(),
    review,
  };
}

export function toScreenedJob(
  candidate: JudgeCandidate,
  result: ScreenResult,
  checkId: string,
  judgedAt: string,
): JudgedJob {
  const repeatOf = result.verdict === 'repeat' ? (candidate.sameTitleAs?.id ?? null) : null;
  return {
    ...candidate.listing,
    fingerprint: candidate.fingerprint,
    verdict: repeatOf ? 'repeat' : 'skip',
    reason: result.reason,
    repeatOf,
    checkId,
    judgedAt,
    review: null,
  };
}

function tally(counts: JobCheckCounts, judged: readonly JudgedJob[]): void {
  counts.judged += judged.length;
  for (const job of judged) counts[job.verdict]++;
}

export function pickInRange(range: Range, random: () => number): number {
  return range.min + Math.floor(random() * (range.max - range.min + 1));
}

export function createPacer(
  limits: Pick<BrowsingLimits, 'loadGapMs' | 'clickGapMs'>,
  sleep: (ms: number) => Promise<void>,
  random: () => number,
): Pacer {
  let queue: Promise<unknown> = Promise.resolve();
  let started = false;
  return <T>(kind: 'load' | 'click', task: () => Promise<T>): Promise<T> => {
    const run = queue.then(async () => {
      if (started) {
        const { min, max } = kind === 'click' ? limits.clickGapMs : limits.loadGapMs;
        const gap = Math.round(min + random() * (max - min));
        if (gap > 0) await sleep(gap);
      }
      started = true;
      return task();
    });
    queue = run.catch(() => undefined);
    return run;
  };
}

export function createLimiter(limit: number) {
  let active = 0;
  const waiting: Array<() => void> = [];
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (active >= limit) await new Promise<void>((resolve) => waiting.push(resolve));
    active++;
    try {
      return await task();
    } finally {
      active--;
      waiting.shift()?.();
    }
  };
}

function serializedWriter(now: () => Date) {
  let queue: Promise<unknown> = Promise.resolve();
  return (change: (feed: JobFeed) => JobFeed): Promise<JobFeed> => {
    const next = queue.then(() => updateJobFeed(change, now()));
    queue = next.catch(() => undefined);
    return next;
  };
}

function checkById(feed: JobFeed, id: string): JobCheck {
  const check = feed.checks.find((c) => c.id === id);
  if (!check) throw new Error(`Check ${id} disappeared from storage.`);
  return check;
}

export function bridgeEndpoint(settings: Settings): string {
  const configured = settings.ai.provider === 'claude-bridge' ? settings.ai.endpoint.trim() : '';
  const origin = resolveOriginForPermission(configured || CLAUDE_BRIDGE_DEFAULT_BASE);
  return origin ? origin.slice(0, -1) : CLAUDE_BRIDGE_DEFAULT_BASE;
}

function searchName(search: JobSearch): string {
  return search.label.trim() || new URL(search.url).hostname;
}

function backgroundTabSession(): BrowsingSession {
  let tabId: number | null = null;
  return {
    async open(url, read) {
      if (tabId == null) {
        const tab = await chrome.tabs.create({ url, active: false });
        if (tab.id == null) throw new Error('Chrome did not open a background tab.');
        tabId = tab.id;
        await waitForTabLoad(tabId, () => Promise.resolve(), true);
      } else {
        const id = tabId;
        await waitForTabLoad(id, async () => {
          await chrome.tabs.update(id, { url });
        });
      }
      const [frame] = await chrome.scripting.executeScript({ target: { tabId }, func: read });
      return frame?.result ?? null;
    },
    async run(func, listingId) {
      if (tabId == null) throw new Error('No page is open in the background tab.');
      const [frame] = await chrome.scripting.executeScript({ target: { tabId }, func, args: [listingId] });
      return frame?.result ?? null;
    },
    async close() {
      if (tabId != null) await chrome.tabs.remove(tabId).catch(() => {});
      tabId = null;
    },
  };
}

function waitForTabLoad(tabId: number, navigate: () => Promise<void>, alreadyStarted = false): Promise<void> {
  return new Promise((resolve, reject) => {
    let sawLoading = alreadyStarted;
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      reject(new Error(`The page took longer than ${TAB_LOAD_TIMEOUT_MS / 1000}s to load.`));
    }, TAB_LOAD_TIMEOUT_MS);
    const done = () => {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve();
    };
    const onUpdated = (updatedId: number, info: chrome.tabs.TabChangeInfo) => {
      if (updatedId !== tabId) return;
      if (info.status === 'loading') sawLoading = true;
      if (info.status === 'complete' && sawLoading) done();
    };
    chrome.tabs.onUpdated.addListener(onUpdated);
    navigate()
      .then(() => (alreadyStarted ? chrome.tabs.get(tabId) : null))
      .then((tab) => {
        if (tab?.status === 'complete') done();
      })
      .catch((err: unknown) => {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(onUpdated);
        reject(err instanceof Error ? err : new Error(String(err)));
      });
  });
}

async function askBridge(
  prompt: Prompt,
  endpoint: string,
  model: string,
  maxTokens: number,
  signal?: AbortSignal,
): Promise<string> {
  let text = '';
  try {
    for await (const chunk of streamClaudeBridge({
      apiKey: '',
      model,
      system: prompt.system,
      user: prompt.user,
      maxTokens,
      endpoint,
      raw: true,
      ...(signal ? { signal } : {}),
    })) {
      text += chunk;
    }
  } catch (err) {
    if (err instanceof TypeError) {
      throw new Error(`Couldn't reach the Claude bridge at ${endpoint}. Start it with \`npm run bridge\`.`);
    }
    throw err;
  }
  return text;
}

async function showFitsOnBadge(fits: number): Promise<void> {
  await chrome.action.setBadgeBackgroundColor({ color: '#0284c7' });
  await chrome.action.setBadgeText({ text: fits > 0 ? String(fits) : '' });
}
