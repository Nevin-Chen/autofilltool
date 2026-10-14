import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  bridgeEndpoint,
  createLimiter,
  runJobCheck,
  toScreenedJob,
  type JobCheckDeps,
} from '@/background/job-check';
import { setResumeLibrary, setSettings } from '@/profile/store';
import { bytesToBase64 } from '@/profile/resume';
import { defaultSettings, type JobSearch } from '@/profile/schema';
import { getJobFeed } from '@/jobs/store';
import { JOB_FEEDBACK_KEY } from '@/jobs/feedback';
import { listingFingerprint } from '@/jobs/dedupe';
import {
  NOW,
  POSTED_YESTERDAY,
  SEARCH_URL,
  exampleSourceForUrl,
  judged,
  listing,
  makeExampleBoard,
  sourceLookup,
} from './job-fixtures';

const RESUME_TEXT = [
  'Software Engineer, Recursion Pharma (remote)',
  'Migrated internal sales tools from jQuery to React, cutting order processing time by 20%.',
  'Developed microservices tracking 10,000+ orders/month via REST APIs.',
  'Skills: TypeScript, Ruby on Rails, PostgreSQL',
].join('\n');

const FULL_POSTING = `About the role\nYou will build payment APIs in TypeScript and React. ${'Ship features end to end with a small team. '.repeat(12)}`;

const store: Record<string, unknown> = {};

beforeEach(async () => {
  for (const key of Object.keys(store)) delete store[key];
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: store[key] })),
        set: vi.fn(async (obj: Record<string, unknown>) => {
          Object.assign(store, obj);
        }),
        remove: vi.fn(async (key: string) => {
          delete store[key];
        }),
      },
    },
  });
  const bytes = new TextEncoder().encode(RESUME_TEXT);
  await setResumeLibrary({
    variants: [
      {
        id: 'base',
        label: 'Base',
        filename: 'resume.txt',
        mimeType: 'text/plain',
        size: bytes.length,
        bytesBase64: bytesToBase64(bytes),
        uploadedAt: '2026-10-01T12:00:00.000Z',
      },
    ],
    activeId: 'base',
  });
});

async function saveSearches(
  searches: JobSearch[] = [{ id: 's1', label: 'Software engineer', url: SEARCH_URL }],
  criteria = 'Skip QA and field engineering roles.',
) {
  await setSettings({ ...defaultSettings(), jobs: { searches, criteria } });
}

function listingIds(user: string): string[] {
  return user
    .split('\n')
    .filter((line) => line.startsWith('{'))
    .map((line) => JSON.parse(line).id as string);
}

function screenReply(user: string, verdicts: Record<string, string> = {}, omit: string[] = []): string {
  return JSON.stringify(
    listingIds(user)
      .filter((id) => !omit.includes(id))
      .map((id) => ({ id, verdict: verdicts[id] ?? 'review', reason: `Screened ${id}.` })),
  );
}

function reviewReply(verdict: 'strong' | 'maybe' | 'skip' = 'strong', evidence = 'from jQuery to React'): string {
  return JSON.stringify({
    requirements: [
      { text: 'React', importance: 'must', status: 'met', evidence },
      { text: 'GraphQL', importance: 'nice', status: 'missing', evidence: '' },
    ],
    yearsAsked: 2,
    flags: [],
    verdict,
    confidence: 'high',
    summary: `Judged ${verdict}.`,
  });
}

function titleOf(user: string): string {
  return /^Title: (.*)$/m.exec(user)?.[1] ?? '';
}

function makeDeps() {
  let n = 0;
  const readSearchPage = vi.fn<(url: string) => Promise<unknown>>(async () => [listing()]);
  const readSelected = vi.fn<(listingId: string) => Promise<unknown>>(async () => null);
  const sessions = { opened: 0, closed: 0 };
  return {
    readSearchPage,
    readSelected,
    sessions,
    sourceForUrl: exampleSourceForUrl,
    openSession: vi.fn<JobCheckDeps['openSession']>(() => {
      sessions.opened++;
      return {
        open: (url) => readSearchPage(url),
        run: (_func, listingId) => readSelected(listingId),
        close: async () => {
          sessions.closed++;
        },
      };
    }),
    readListingPage: vi.fn<JobCheckDeps['readListingPage']>(async () => FULL_POSTING),
    screenBatch: vi.fn<JobCheckDeps['screenBatch']>(async ({ user }) => screenReply(user)),
    reviewJob: vi.fn<JobCheckDeps['reviewJob']>(async () => reviewReply()),
    canReachBridge: vi.fn<JobCheckDeps['canReachBridge']>(async () => true),
    setBadge: vi.fn<JobCheckDeps['setBadge']>(async () => {}),
    sleep: vi.fn<JobCheckDeps['sleep']>(async () => {}),
    random: () => 0.5,
    now: () => NOW,
    newId: () => `check-${++n}`,
  };
}

const threeListings = [
  listing(),
  listing({ id: 'example:k2globex0001', company: 'Globex', title: 'Field Engineer I', requirements: 'Travel to wind sites.' }),
  listing({ id: 'example:k2bd0001', company: 'Boston Dynamics', title: 'Robotics Software Engineer', requirements: 'C++ and ROS.' }),
];

describe('runJobCheck', () => {
  it('screens everything, reviews the survivors from the full posting, and stores both', async () => {
    await saveSearches();
    const deps = makeDeps();
    deps.readSearchPage.mockResolvedValue(threeListings);
    deps.screenBatch.mockImplementation(async ({ user }) => screenReply(user, { 'example:k2globex0001': 'skip' }));
    deps.reviewJob.mockImplementation(async ({ user }) =>
      reviewReply(titleOf(user) === 'Robotics Software Engineer' ? 'maybe' : 'strong'),
    );

    const check = await runJobCheck(deps);

    expect(check.status).toBe('ok');
    expect(check.counts).toMatchObject({ postedToday: 3, judged: 3, reviewed: 2, strong: 1, maybe: 1, skip: 1, summaryOnly: 0 });
    expect(deps.readListingPage).toHaveBeenCalledTimes(2);
    expect(deps.readListingPage).toHaveBeenCalledWith('https://jobs.example.com/listings/k2stripe0001', expect.anything());
    expect(deps.reviewJob.mock.calls[0]?.[0].user).toContain('You will build payment APIs');
    expect(deps.setBadge).toHaveBeenCalledWith(2);

    const jobs = new Map((await getJobFeed()).jobs.map((job) => [job.id, job]));
    expect(jobs.get('example:k2globex0001')).toMatchObject({ verdict: 'skip', review: null, reason: 'Screened example:k2globex0001.' });
    expect(jobs.get('example:k2stripe0001')?.review).toMatchObject({ descriptionSource: 'full', confidence: 'high' });
    expect(jobs.get('example:k2stripe0001')?.review?.requirements[0]?.verified).toBe(true);
  });

  it('passes the criteria and past disagreements to both passes', async () => {
    await saveSearches(undefined, 'Remote or NYC only.');
    store[JOB_FEEDBACK_KEY] = [
      {
        jobId: 'example:old',
        agree: false,
        note: 'Java-only shops are a skip.',
        at: '2026-10-12T12:00:00.000Z',
        title: 'Backend Engineer',
        company: 'Globex',
        verdict: 'maybe',
      },
    ];
    const deps = makeDeps();
    await runJobCheck(deps);
    for (const call of [deps.screenBatch.mock.calls[0], deps.reviewJob.mock.calls[0]]) {
      expect(call?.[0].user).toContain('Remote or NYC only.');
      expect(call?.[0].user).toContain('Java-only shops are a skip.');
    }
  });

  it("falls back to the board's summary when the job page can't be read", async () => {
    await saveSearches();
    const deps = makeDeps();
    deps.readListingPage.mockResolvedValue(null);
    const check = await runJobCheck(deps);
    expect(check.counts).toMatchObject({ reviewed: 1, summaryOnly: 1 });
    expect(deps.reviewJob.mock.calls[0]?.[0].user).toMatch(/only the job board's short summary/);
    expect((await getJobFeed()).jobs[0]?.review?.descriptionSource).toBe('summary');
  });

  it('moves a strong verdict to maybe when its evidence is not in the résumé', async () => {
    await saveSearches();
    const deps = makeDeps();
    deps.reviewJob.mockResolvedValue(reviewReply('strong', 'Led a team of 8 engineers'));
    const check = await runJobCheck(deps);
    expect(check.counts).toMatchObject({ strong: 0, maybe: 1 });
    expect((await getJobFeed()).jobs[0]?.review).toMatchObject({ claudeVerdict: 'strong', demotedForUnverifiedEvidence: true });
  });

  it('does not judge the same listing twice', async () => {
    await saveSearches();
    const deps = makeDeps();
    await runJobCheck(deps);
    const second = await runJobCheck(deps);
    expect(deps.screenBatch).toHaveBeenCalledTimes(1);
    expect(deps.reviewJob).toHaveBeenCalledTimes(1);
    expect(second.counts).toMatchObject({ alreadySeen: 1, judged: 0 });
  });

  it('leaves a listing the screen skipped over unjudged so the next check retries it', async () => {
    await saveSearches();
    const deps = makeDeps();
    deps.readSearchPage.mockResolvedValue(threeListings);
    deps.screenBatch.mockImplementation(async ({ user }) => screenReply(user, {}, ['example:k2bd0001']));
    const first = await runJobCheck(deps);
    expect(first.counts).toMatchObject({ judged: 2, unjudged: 1 });

    deps.screenBatch.mockImplementation(async ({ user }) => screenReply(user));
    const second = await runJobCheck(deps);
    expect(second.counts).toMatchObject({ alreadySeen: 2, judged: 1 });
  });

  it('counts an unreadable review as unjudged and keeps the others', async () => {
    await saveSearches();
    const deps = makeDeps();
    deps.readSearchPage.mockResolvedValue(threeListings);
    deps.reviewJob.mockImplementation(async ({ user }) =>
      titleOf(user) === 'Field Engineer I' ? 'I could not review this posting.' : reviewReply(),
    );
    const check = await runJobCheck(deps);
    expect(check.status).toBe('ok');
    expect(check.counts).toMatchObject({ reviewed: 2, unjudged: 1 });
  });

  it('keeps going when one review fails', async () => {
    await saveSearches();
    const deps = makeDeps();
    deps.readSearchPage.mockResolvedValue(threeListings);
    deps.reviewJob.mockImplementation(async ({ user }) => {
      if (titleOf(user) === 'Field Engineer I') throw new Error('claude exited without producing output');
      return reviewReply();
    });
    const check = await runJobCheck(deps);
    expect(check.status).toBe('ok');
    expect(check.counts).toMatchObject({ reviewed: 2, unjudged: 1 });
  });

  it('fails the check when every review fails, keeping the screen results', async () => {
    await saveSearches();
    const deps = makeDeps();
    deps.readSearchPage.mockResolvedValue(threeListings);
    deps.screenBatch.mockImplementation(async ({ user }) => screenReply(user, { 'example:k2globex0001': 'skip' }));
    deps.reviewJob.mockRejectedValue(new Error('claude exited without producing output'));
    const check = await runJobCheck(deps);
    expect(check.status).toBe('failed');
    expect(check.error).toBe('claude exited without producing output');
    expect((await getJobFeed()).jobs.map((job) => job.id)).toEqual(['example:k2globex0001']);
  });

  it('stores every review when several finish at the same time', async () => {
    await saveSearches();
    const hits = Array.from({ length: 7 }, (_, i) =>
      listing({ id: `example:req-${i}`, title: `Software Engineer ${i}`, requirements: `Set ${i}.` }),
    );
    const deps = makeDeps();
    deps.readSearchPage.mockResolvedValue(hits);
    deps.reviewJob.mockImplementation(async ({ user }) => {
      await new Promise((resolve) => setTimeout(resolve, (7 - Number(titleOf(user).slice(-1))) * 3));
      return reviewReply();
    });
    const check = await runJobCheck(deps);
    expect(check.counts?.reviewed).toBe(7);
    expect((await getJobFeed()).jobs).toHaveLength(7);
  });

  it('screens 20 listings at a time', async () => {
    await saveSearches();
    const hits = Array.from({ length: 25 }, (_, i) =>
      listing({ id: `example:req-${i}`, title: `Software Engineer ${i}`, requirements: `Set ${i}.` }),
    );
    const deps = makeDeps();
    deps.readSearchPage.mockResolvedValue(hits);
    deps.screenBatch.mockImplementation(async ({ user }) =>
      JSON.stringify(listingIds(user).map((id) => ({ id, verdict: 'skip', reason: 'Not a fit.' }))),
    );
    const check = await runJobCheck(deps);
    expect(deps.screenBatch).toHaveBeenCalledTimes(2);
    expect(listingIds(deps.screenBatch.mock.calls[0]![0].user)).toHaveLength(20);
    expect(check.counts).toMatchObject({ judged: 25, skip: 25, reviewed: 0 });
    expect(deps.reviewJob).not.toHaveBeenCalled();
  });

  it('fails with a pointer to the Jobs page when there are no saved searches', async () => {
    await saveSearches([]);
    const check = await runJobCheck(makeDeps());
    expect(check.status).toBe('failed');
    expect(check.error).toMatch(/Add a saved search/);
  });

  it('fails on a board without a source', async () => {
    await saveSearches([{ id: 's1', label: 'LinkedIn', url: 'https://www.linkedin.com/jobs/search/?keywords=software' }]);
    const check = await runJobCheck(makeDeps());
    expect(check.error).toBe("LinkedIn isn't on a supported job board yet.");
  });

  it('reports a possible bot check when the search page has no job data, without retrying', async () => {
    await saveSearches();
    const deps = makeDeps();
    deps.readSearchPage.mockResolvedValue(null);
    const check = await runJobCheck(deps);
    expect(check.error).toMatch(/job board is showing a bot check/);
    expect(deps.readSearchPage).toHaveBeenCalledTimes(1);
    expect(deps.screenBatch).not.toHaveBeenCalled();
  });

  it('fails before opening any tab when the bridge origin is not permitted', async () => {
    await saveSearches();
    const deps = makeDeps();
    deps.canReachBridge.mockResolvedValue(false);
    const check = await runJobCheck(deps);
    expect(check.error).toMatch(/No permission to reach the Claude bridge/);
    expect(deps.readSearchPage).not.toHaveBeenCalled();
  });

  it('records a bridge failure during the screen and stores no verdicts', async () => {
    await saveSearches();
    const deps = makeDeps();
    deps.screenBatch.mockRejectedValue(
      new Error("Couldn't reach the Claude bridge at http://localhost:11435. Start it with `npm run bridge`."),
    );
    const check = await runJobCheck(deps);
    expect(check.status).toBe('failed');
    expect(check.error).toMatch(/npm run bridge/);
    expect((await getJobFeed()).jobs).toEqual([]);
    expect(deps.setBadge).not.toHaveBeenCalled();
  });
});

describe('toScreenedJob', () => {
  const plain = { listing: listing(), fingerprint: listingFingerprint(listing()), sameTitleAs: null };

  it('records which listing a repeat repeats', () => {
    const earlier = judged({ id: 'example:first' });
    const job = toScreenedJob({ ...plain, sameTitleAs: earlier }, { verdict: 'repeat', reason: 'Same role.' }, 'c', NOW.toISOString());
    expect(job).toMatchObject({ verdict: 'repeat', repeatOf: 'example:first', review: null });
  });

  it('turns a repeat with nothing to repeat into a skip', () => {
    const job = toScreenedJob(plain, { verdict: 'repeat', reason: 'Looks familiar.' }, 'c', NOW.toISOString());
    expect(job).toMatchObject({ verdict: 'skip', repeatOf: null });
  });
});

describe('createLimiter', () => {
  it('never runs more than the limit at once', async () => {
    const limit = createLimiter(3);
    let inFlight = 0;
    let peak = 0;
    await Promise.all(
      [1, 2, 3, 4, 5, 6, 7].map(() =>
        limit(async () => {
          inFlight++;
          peak = Math.max(peak, inFlight);
          await new Promise((resolve) => setTimeout(resolve, 2));
          inFlight--;
        }),
      ),
    );
    expect(peak).toBe(3);
  });
});

describe('bridgeEndpoint', () => {
  it('uses the configured bridge endpoint when the bridge is the AI provider', () => {
    const settings = defaultSettings();
    settings.ai = { ...settings.ai, provider: 'claude-bridge', endpoint: 'http://127.0.0.1:11500/v1/chat/completions' };
    expect(bridgeEndpoint(settings)).toBe('http://127.0.0.1:11500');
  });

  it('falls back to the default bridge port otherwise', () => {
    const settings = defaultSettings();
    settings.ai = { ...settings.ai, provider: 'ollama', endpoint: 'http://localhost:11434' };
    expect(bridgeEndpoint(settings)).toBe('http://localhost:11435');
  });
});

describe('runJobCheck on a paginated, paced board', () => {
  function pages(...groups: Array<Array<ReturnType<typeof listing>>>) {
    return groups.map((listings, i) => ({ listings, hasNext: i < groups.length - 1 }));
  }

  function distinct(prefix: string, count: number) {
    return Array.from({ length: count }, (_, i) =>
      listing({ id: `example:${prefix}-${i}`, title: `Software Engineer ${prefix} ${i}`, requirements: `Set ${prefix} ${i}.` }),
    );
  }

  it('reads every results page until the board has no next page', async () => {
    await saveSearches();
    const deps = makeDeps();
    const results = pages(distinct('a', 2), distinct('b', 2), distinct('c', 1));
    deps.readSearchPage.mockImplementation(async (url) => results[Number(/page=(\d+)/.exec(url)?.[1] ?? 1) - 1]);
    const check = await runJobCheck(deps);
    expect(deps.readSearchPage.mock.calls.map(([url]) => url)).toEqual([SEARCH_URL, `${SEARCH_URL}&page=2`, `${SEARCH_URL}&page=3`]);
    expect(check.counts).toMatchObject({ postedToday: 5, reviewed: 5 });
  });

  it('stops at the board\'s page limit', async () => {
    await saveSearches();
    const board = makeExampleBoard({ limits: { minGapMs: 0, maxGapMs: 0, minClickGapMs: 0, maxClickGapMs: 0, maxSearchPages: 2, maxDetailReads: 40 } });
    const deps = { ...makeDeps(), sourceForUrl: sourceLookup(board) };
    deps.readSearchPage.mockResolvedValue({ listings: distinct('x', 1), hasNext: true });
    await runJobCheck(deps);
    expect(deps.readSearchPage).toHaveBeenCalledTimes(2);
  });

  it('waits a random gap between page loads on a board, but not before the first', async () => {
    await saveSearches();
    const board = makeExampleBoard({ limits: { minGapMs: 3_000, maxGapMs: 8_000, minClickGapMs: 0, maxClickGapMs: 0, maxSearchPages: 5, maxDetailReads: 40 } });
    const deps = { ...makeDeps(), sourceForUrl: sourceLookup(board) };
    const events: string[] = [];
    deps.sleep.mockImplementation(async (ms) => {
      events.push(`sleep ${ms}`);
    });
    deps.readSearchPage.mockImplementation(async (url) => {
      events.push('search');
      return url.includes('page=2') ? { listings: distinct('b', 1), hasNext: false } : { listings: distinct('a', 1), hasNext: true };
    });
    deps.readListingPage.mockImplementation(async () => {
      events.push('job page');
      return 'You will build payment APIs in TypeScript and React. '.repeat(10);
    });
    await runJobCheck(deps);
    expect(events).toEqual(['search', 'sleep 5500', 'job page', 'sleep 5500', 'search', 'sleep 5500', 'job page']);
  });

  it('counts result cards the board did not finish drawing', async () => {
    await saveSearches();
    const board = makeExampleBoard({ unreadCards: (raw) => ((raw as { unread?: number }).unread ?? 0) });
    const deps = { ...makeDeps(), sourceForUrl: sourceLookup(board) };
    deps.readSearchPage.mockResolvedValue({ listings: distinct('u', 1), unread: 3 });
    const check = await runJobCheck(deps);
    expect(check.counts).toMatchObject({ unreadCards: 3, reviewed: 1 });
  });

  it('judges older results from a board without the posted-today rule', async () => {
    await saveSearches();
    const rolling = makeExampleBoard({ postedTodayOnly: false });
    const deps = { ...makeDeps(), sourceForUrl: sourceLookup(rolling) };
    deps.readSearchPage.mockResolvedValue([listing({ postedAt: POSTED_YESTERDAY })]);
    const check = await runJobCheck(deps);
    expect(check.counts).toMatchObject({ postedToday: 1, reviewed: 1 });
  });

  it('leaves jobs past the per-check page limit for the next check', async () => {
    await saveSearches();
    const board = makeExampleBoard({ limits: { minGapMs: 0, maxGapMs: 0, minClickGapMs: 0, maxClickGapMs: 0, maxSearchPages: 5, maxDetailReads: 2 } });
    const deps = { ...makeDeps(), sourceForUrl: sourceLookup(board) };
    deps.readSearchPage.mockResolvedValue(distinct('d', 5));
    const first = await runJobCheck(deps);
    expect(deps.readListingPage).toHaveBeenCalledTimes(2);
    expect(first.counts).toMatchObject({ reviewed: 2, deferred: 3 });

    const second = await runJobCheck(deps);
    expect(second.counts).toMatchObject({ alreadySeen: 2, reviewed: 2, deferred: 1 });
  });

  it('stops before screening when a results page is a security check', async () => {
    await saveSearches();
    const deps = makeDeps();
    deps.readSearchPage.mockResolvedValue({ blocked: true });
    const check = await runJobCheck(deps);
    expect(check.status).toBe('failed');
    expect(check.error).toMatch(/showed a security check or sign-in page/);
    expect(deps.screenBatch).not.toHaveBeenCalled();
  });

  it('stops opening job pages after a security check, keeping finished reviews', async () => {
    await saveSearches();
    const deps = makeDeps();
    deps.readSearchPage.mockResolvedValue(distinct('e', 4));
    let reads = 0;
    deps.readListingPage.mockImplementation(async () => (++reads === 2 ? { blocked: true } : FULL_POSTING));
    const check = await runJobCheck(deps);
    expect(deps.readListingPage).toHaveBeenCalledTimes(2);
    expect(check.status).toBe('failed');
    expect(check.error).toMatch(/stopped browsing that board/);
    expect(check.counts).toMatchObject({ reviewed: 1, deferred: 3 });
    expect((await getJobFeed()).jobs).toHaveLength(1);
  });

  it('stores the apply link and Easy Apply flag read from the job page', async () => {
    await saveSearches();
    const deps = makeDeps();
    deps.readSearchPage.mockResolvedValue([listing({ applyUrl: null })]);
    deps.readListingPage.mockResolvedValue({
      description: FULL_POSTING,
      applyUrl: 'https://job-boards.greenhouse.io/stripe/jobs/7000001',
      easyApply: true,
    });
    await runJobCheck(deps);
    expect((await getJobFeed()).jobs[0]).toMatchObject({
      applyUrl: 'https://job-boards.greenhouse.io/stripe/jobs/7000001',
      easyApply: true,
    });
  });

  it('does not review a job with neither a readable posting nor a summary', async () => {
    await saveSearches();
    const deps = makeDeps();
    deps.readSearchPage.mockResolvedValue([listing({ requirements: '' })]);
    deps.readListingPage.mockResolvedValue(null);
    const check = await runJobCheck(deps);
    expect(deps.reviewJob).not.toHaveBeenCalled();
    expect(check.counts).toMatchObject({ reviewed: 0, unjudged: 1 });
  });
});

describe('runJobCheck on a board that loads details in the page', () => {
  const spaBoard = makeExampleBoard({
    readSelected: () => null,
    limits: { minGapMs: 3_000, maxGapMs: 8_000, minClickGapMs: 2_000, maxClickGapMs: 4_000, maxSearchPages: 5, maxDetailReads: 40 },
  });

  function spaDeps() {
    const deps = { ...makeDeps(), sourceForUrl: sourceLookup(spaBoard) };
    deps.readSelected.mockImplementation(async (listingId) => ({
      description: `${FULL_POSTING} (${listingId})`,
      applyUrl: 'https://job-boards.greenhouse.io/stripe/jobs/7000001',
      easyApply: false,
    }));
    return deps;
  }

  it('clicks each surviving job in the open search tab instead of opening its page', async () => {
    await saveSearches();
    const deps = spaDeps();
    deps.readSearchPage.mockResolvedValue(threeListings);
    const check = await runJobCheck(deps);
    expect(deps.readSelected).toHaveBeenCalledTimes(3);
    expect(deps.readListingPage).not.toHaveBeenCalled();
    expect(check.counts).toMatchObject({ reviewed: 3, summaryOnly: 0 });
    expect(deps.reviewJob.mock.calls[0]?.[0].user).toContain(`(${deps.readSelected.mock.calls[0]?.[0]})`);
  });

  it('opens one tab per search and closes it', async () => {
    await saveSearches([
      { id: 's1', label: 'Software engineer', url: SEARCH_URL },
      { id: 's2', label: 'Platform engineer', url: 'https://jobs.example.com/search?q=platform' },
    ]);
    const deps = spaDeps();
    deps.readSearchPage.mockImplementation(async (url) =>
      url.includes('platform') ? [listing({ id: 'example:platform-1', title: 'Platform Engineer', requirements: 'Kubernetes.' })] : [listing()],
    );
    await runJobCheck(deps);
    expect(deps.sessions).toEqual({ opened: 2, closed: 2 });
  });

  it('clicks the newest postings first', async () => {
    await saveSearches();
    const deps = spaDeps();
    deps.readSearchPage.mockResolvedValue([
      listing({ id: 'example:older', title: 'Older', requirements: 'a', postedAt: '2026-10-13T12:00:00.000Z' }),
      listing({ id: 'example:newest', title: 'Newest', requirements: 'b', postedAt: '2026-10-13T17:30:00.000Z' }),
      listing({ id: 'example:middle', title: 'Middle', requirements: 'c', postedAt: '2026-10-13T15:00:00.000Z' }),
    ]);
    await runJobCheck(deps);
    expect(deps.readSelected.mock.calls.map(([id]) => id)).toEqual(['example:newest', 'example:middle', 'example:older']);
  });

  it('waits the shorter click gap between clicks and the page gap before the next page', async () => {
    await saveSearches();
    const deps = spaDeps();
    deps.readSearchPage.mockImplementation(async (url) =>
      url.includes('page=2')
        ? { listings: [listing({ id: 'example:b', title: 'B', requirements: 'b' })], hasNext: false }
        : { listings: [listing({ id: 'example:a1', title: 'A1', requirements: 'a1' }), listing({ id: 'example:a2', title: 'A2', requirements: 'a2' })], hasNext: true },
    );
    await runJobCheck(deps);
    expect(deps.sleep.mock.calls.map(([ms]) => ms)).toEqual([3_000, 3_000, 5_500, 3_000]);
  });

  it("opens the job's page when its card can't be found", async () => {
    await saveSearches();
    const deps = spaDeps();
    deps.readSelected.mockResolvedValue({ missing: true });
    const check = await runJobCheck(deps);
    expect(deps.readListingPage).toHaveBeenCalledTimes(1);
    expect(check.counts).toMatchObject({ reviewed: 1 });
  });

  it('stops browsing when a click lands on a security check', async () => {
    await saveSearches();
    const deps = spaDeps();
    deps.readSearchPage.mockResolvedValue(threeListings);
    deps.readSelected.mockResolvedValue({ blocked: true });
    const check = await runJobCheck(deps);
    expect(deps.readSelected).toHaveBeenCalledTimes(1);
    expect(check.status).toBe('failed');
    expect(check.counts).toMatchObject({ deferred: 3, reviewed: 0 });
  });
});
