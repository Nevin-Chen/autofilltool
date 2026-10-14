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
import { sourceForUrl, type BrowsingLimits, type JobSource, type ListingDetails } from '@/jobs/sources';
import { localDateKey, selectNewListings, type JudgeCandidate } from '@/jobs/dedupe';
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
  type DeepReview,
  type JobCheck,
  type JobCheckCounts,
  type JobFeed,
  type JobListing,
  type JudgedJob,
} from '@/jobs/schema';

export const TAB_LOAD_TIMEOUT_MS = 30_000;

type Prompt = { system: string; user: string };

export type JobCheckDeps = {
  sourceForUrl: (url: string) => JobSource | null;
  readSearchPage: (url: string, source: JobSource) => Promise<unknown>;
  readListingPage: (url: string, source: JobSource) => Promise<unknown>;
  screenBatch: (prompt: Prompt, endpoint: string) => Promise<string>;
  reviewJob: (prompt: Prompt, endpoint: string) => Promise<string>;
  canReachBridge: (endpoint: string) => Promise<boolean>;
  setBadge: (fits: number) => Promise<void>;
  sleep: (ms: number) => Promise<void>;
  random: () => number;
  now: () => Date;
  newId: () => string;
};

export const defaultJobCheckDeps: JobCheckDeps = {
  sourceForUrl,
  readSearchPage: (url, source) => readInBackgroundTab(url, source.readPage),
  readListingPage: (url, source) =>
    source.readListingPage ? readInBackgroundTab(url, source.readListingPage) : Promise.resolve(null),
  screenBatch: (prompt, endpoint) => askBridge(prompt, endpoint, JOB_SCREEN_MODEL, JOB_SCREEN_MAX_TOKENS),
  reviewJob: (prompt, endpoint) => askBridge(prompt, endpoint, JOB_REVIEW_MODEL, JOB_REVIEW_MAX_TOKENS),
  canReachBridge: (endpoint) => hasOriginPermission(endpoint),
  setBadge: showFitsOnBadge,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  random: Math.random,
  now: () => new Date(),
  newId: () => crypto.randomUUID(),
};

type Pacer = <T>(task: () => Promise<T>) => Promise<T>;
type Advanced = { candidate: JudgeCandidate; source: JobSource };

const BLOCKED_ELSEWHERE = Symbol('blocked-elsewhere');

export async function runJobCheck(deps: JobCheckDeps = defaultJobCheckDeps): Promise<JobCheck> {
  const checkId = deps.newId();
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
  try {
    const [settings, profile, library, feedback] = await Promise.all([
      getSettings(),
      getProfile(),
      getResumeLibrary(),
      getJobFeedback(),
    ]);
    const searches = settings.jobs.searches;
    if (searches.length === 0) throw new Error('Add a saved search on the Jobs page first.');
    const endpoint = bridgeEndpoint(settings);
    if (!(await deps.canReachBridge(endpoint))) {
      throw new Error(`No permission to reach the Claude bridge at ${endpoint}. Grant it in Options > AI.`);
    }

    const listings: Array<{ listing: JobListing; source: JobSource }> = [];
    for (const search of searches) {
      const source = deps.sourceForUrl(search.url);
      if (!source) throw new Error(`${searchName(search)} isn't on a supported job board yet.`);
      const found = await readSearchResults(search, source, paceFor(source), deps, counts, (phase) =>
        patchCheck({ phase }),
      );
      listings.push(...found.map((listing) => ({ listing, source })));
    }
    const sourceById = new Map(listings.map(({ listing, source }) => [listing.id, source]));

    const selection = selectNewListings(
      listings.map(({ listing }) => listing),
      (await getJobFeed()).jobs,
      localDateKey(deps.now()),
      (listing) => sourceById.get(listing.id)?.postedTodayOnly ?? true,
    );
    counts.postedToday = selection.postedToday;
    counts.alreadySeen = selection.alreadySeen;
    counts.identicalRepeats = selection.identicalRepeats;

    const resume = defaultVariant(library);
    const context: CandidateContext = {
      profileSummary: summarizeProfileForClassifier(profile),
      resumeText: resume ? await extractResumeText(resume) : '',
      criteria: settings.jobs.criteria,
      disagreements: recentDisagreements(feedback),
    };

    const { candidates } = selection;
    const advanced: Advanced[] = [];
    for (let start = 0; start < candidates.length; start += JOB_SCREEN_BATCH_SIZE) {
      const batch = candidates.slice(start, start + JOB_SCREEN_BATCH_SIZE);
      await patchCheck({
        phase: `Screening ${start + 1}-${start + batch.length} of ${candidates.length}`,
      });
      const results = parseScreenResponse(await deps.screenBatch(buildScreenPrompt(batch, context), endpoint));
      const judgedAt = deps.now().toISOString();
      const settled: JudgedJob[] = [];
      for (const candidate of batch) {
        const result = results.get(candidate.listing.id);
        const source = sourceById.get(candidate.listing.id);
        if (!result || !source) {
          counts.unjudged++;
        } else if (result.verdict === 'review') {
          advanced.push({ candidate, source });
        } else {
          settled.push(toScreenedJob(candidate, result, checkId, judgedAt));
        }
      }
      tally(counts, settled);
      await storeJobs(settled);
    }

    const listingPagesLeft = new Map<string, number>();
    const blockedSources = new Set<string>();
    let blockedMessage: string | null = null;
    const readDetails = async (
      listing: JobListing,
      source: JobSource,
    ): Promise<ListingDetails | null | 'deferred'> => {
      if (!source.readListingPage || !source.toDetails || !listing.listingUrl) return null;
      if (blockedSources.has(source.id)) return 'deferred';
      const left = listingPagesLeft.get(source.id) ?? source.limits.maxListingPages;
      if (left <= 0) return 'deferred';
      listingPagesLeft.set(source.id, left - 1);
      const raw = await paceFor(source)(async () =>
        blockedSources.has(source.id)
          ? BLOCKED_ELSEWHERE
          : deps.readListingPage(listing.listingUrl, source).catch(() => null),
      );
      if (raw === BLOCKED_ELSEWHERE) return 'deferred';
      if (source.isBlocked(raw)) {
        blockedSources.add(source.id);
        blockedMessage ??=
          'A job page showed a security check or sign-in page, so the check stopped opening pages on that board. Open it in a tab yourself and deal with it there, then check again.';
        return 'deferred';
      }
      return source.toDetails(raw);
    };

    let finishedReviews = 0;
    let lastReviewError: unknown = null;
    const reportProgress = () =>
      patchCheck({ phase: `Claude is reviewing full postings: ${finishedReviews} of ${advanced.length} done` });
    if (advanced.length > 0) await reportProgress();
    await mapWithConcurrency(advanced, JOB_REVIEW_CONCURRENCY, async ({ candidate, source }) => {
      try {
        const details = await readDetails(candidate.listing, source);
        if (details === 'deferred') {
          counts.deferred++;
          return;
        }
        const job = await reviewCandidate(candidate, details, context, endpoint, checkId, deps);
        if (job) {
          tally(counts, [job]);
          counts.reviewed++;
          if (job.review?.descriptionSource === 'summary') counts.summaryOnly++;
          await storeJobs([job]);
        } else {
          counts.unjudged++;
        }
      } catch (err) {
        counts.unjudged++;
        lastReviewError = err;
      } finally {
        finishedReviews++;
        if (finishedReviews < advanced.length) await reportProgress();
      }
    });
    if (blockedMessage) throw new Error(blockedMessage);
    if (advanced.length > 0 && counts.reviewed === 0 && lastReviewError) throw lastReviewError;

    const feed = await patchCheck({ status: 'ok', phase: '', finishedAt: deps.now().toISOString(), counts });
    await deps.setBadge(counts.strong + counts.maybe);
    return checkById(feed, checkId);
  } catch (err) {
    const feed = await patchCheck({
      status: 'failed',
      phase: '',
      finishedAt: deps.now().toISOString(),
      error: err instanceof Error ? err.message : String(err),
      counts,
    });
    return checkById(feed, checkId);
  }
}

async function readSearchResults(
  search: JobSearch,
  source: JobSource,
  pace: Pacer,
  deps: JobCheckDeps,
  counts: JobCheckCounts,
  report: (phase: string) => Promise<unknown>,
): Promise<JobListing[]> {
  const listings: JobListing[] = [];
  for (let page = 0; page < source.limits.maxSearchPages; page++) {
    await report(page === 0 ? `Reading ${searchName(search)}` : `Reading ${searchName(search)}, page ${page + 1}`);
    const raw = await pace(() => deps.readSearchPage(source.searchPageUrl(search.url, page), source));
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
    listings.push(...found);
    counts.unreadCards += source.unreadCards?.(raw) ?? 0;
    if (found.length === 0 || !source.hasMorePages(raw)) break;
  }
  return listings;
}

async function reviewCandidate(
  candidate: JudgeCandidate,
  details: ListingDetails | null,
  context: CandidateContext,
  endpoint: string,
  checkId: string,
  deps: JobCheckDeps,
): Promise<JudgedJob | null> {
  const listing: JobListing = {
    ...candidate.listing,
    applyUrl: details?.applyUrl ?? candidate.listing.applyUrl,
    easyApply: candidate.listing.easyApply || (details?.easyApply ?? false),
  };
  const fullDescription =
    details?.description && details.description.length >= MIN_FULL_DESCRIPTION_CHARS ? details.description : null;
  const description = fullDescription ?? (listing.requirements.trim() || null);
  if (!description) return null;
  const descriptionSource: DeepReview['descriptionSource'] = fullDescription ? 'full' : 'summary';
  const raw = parseReviewResponse(
    await deps.reviewJob(buildReviewPrompt({ listing, description, descriptionSource }, context), endpoint),
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

export function createPacer(
  limits: Pick<BrowsingLimits, 'minGapMs' | 'maxGapMs'>,
  sleep: (ms: number) => Promise<void>,
  random: () => number,
): Pacer {
  let queue: Promise<unknown> = Promise.resolve();
  let started = false;
  return <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(async () => {
      if (started) {
        const gap = Math.round(limits.minGapMs + random() * (limits.maxGapMs - limits.minGapMs));
        if (gap > 0) await sleep(gap);
      }
      started = true;
      return task();
    });
    queue = run.catch(() => undefined);
    return run;
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

export async function mapWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  run: (item: T) => Promise<void>,
): Promise<void> {
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const item = items[index++]!;
      await run(item);
    }
  });
  await Promise.all(workers);
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

async function readInBackgroundTab(url: string, readPage: () => unknown): Promise<unknown> {
  const tab = await chrome.tabs.create({ url, active: false });
  const tabId = tab.id;
  if (tabId == null) throw new Error('Chrome did not open a background tab.');
  try {
    await waitForTabLoad(tabId, TAB_LOAD_TIMEOUT_MS);
    const [frame] = await chrome.scripting.executeScript({ target: { tabId }, func: readPage });
    return frame?.result ?? null;
  } finally {
    await chrome.tabs.remove(tabId).catch(() => {});
  }
}

function waitForTabLoad(tabId: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      reject(new Error(`The page took longer than ${timeoutMs / 1000}s to load.`));
    }, timeoutMs);
    const done = () => {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve();
    };
    const onUpdated = (updatedId: number, info: chrome.tabs.TabChangeInfo) => {
      if (updatedId === tabId && info.status === 'complete') done();
    };
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs
      .get(tabId)
      .then((tab) => {
        if (tab.status === 'complete') done();
      })
      .catch(() => {});
  });
}

async function askBridge(prompt: Prompt, endpoint: string, model: string, maxTokens: number): Promise<string> {
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
