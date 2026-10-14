import type { JobListing, JudgedJob } from '@/jobs/schema';
import type { JobSource, ListingDetails } from '@/jobs/sources';
import { listingFingerprint } from '@/jobs/dedupe';

export const POSTED_TODAY = '2026-10-13T16:27:00.000Z';
export const POSTED_YESTERDAY = '2026-10-12T16:27:00.000Z';
export const NOW = new Date('2026-10-13T18:00:00.000Z');

export const SEARCH_URL = 'https://jobs.example.com/search?q=software+engineer&posted=today';

type ExamplePage = { listings?: JobListing[]; hasNext?: boolean; blocked?: boolean };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function makeExampleBoard(overrides: Partial<JobSource> = {}): JobSource {
  return {
    id: 'example',
    matches: (url) => url.hostname === 'jobs.example.com',
    postedTodayOnly: true,
    limits: { loadGapMs: { min: 0, max: 0 }, clickGapMs: { min: 0, max: 0 }, searchPages: { min: 5, max: 5 }, detailReads: { min: 40, max: 40 } },
    searchPageUrl: (searchUrl, pageIndex) => (pageIndex === 0 ? searchUrl : `${searchUrl}&page=${pageIndex + 1}`),
    readPage: () => null,
    toListings: (raw) => {
      if (Array.isArray(raw)) return raw as JobListing[];
      if (isRecord(raw) && Array.isArray(raw.listings)) return (raw as ExamplePage).listings ?? [];
      return null;
    },
    hasMorePages: (raw) => isRecord(raw) && raw.hasNext === true,
    isBlocked: (raw) => isRecord(raw) && raw.blocked === true,
    readListingPage: () => null,
    toDetails: (raw): ListingDetails | null => {
      if (typeof raw === 'string' && raw.trim()) return { description: raw.trim(), applyUrl: null, easyApply: false, postedAt: null };
      if (isRecord(raw) && !raw.blocked && !raw.missing) {
        return {
          description: typeof raw.description === 'string' ? raw.description : null,
          applyUrl: typeof raw.applyUrl === 'string' ? raw.applyUrl : null,
          easyApply: raw.easyApply === true,
          postedAt: typeof raw.postedAt === 'string' ? raw.postedAt : null,
        };
      }
      return null;
    },
    ...overrides,
  };
}

export const exampleBoard = makeExampleBoard();

export function sourceLookup(board: JobSource) {
  return (raw: string): JobSource | null => {
    try {
      return board.matches(new URL(raw)) ? board : null;
    } catch {
      return null;
    }
  };
}

export const exampleSourceForUrl = sourceLookup(exampleBoard);

export function listing(overrides: Partial<JobListing> = {}): JobListing {
  const id = overrides.id ?? 'example:k2stripe0001';
  return {
    id,
    source: 'example',
    title: 'Software Engineer, Payments',
    company: 'Stripe',
    location: 'New York City, New York, United States',
    workplace: 'Hybrid',
    category: 'Software Development',
    minYoe: 2,
    pay: '$140k-$185k',
    postedAt: POSTED_TODAY,
    requirements: '2+ years building web services in TypeScript or Ruby; REST APIs; PostgreSQL.',
    tools: ['TypeScript', 'Ruby', 'PostgreSQL'],
    listingUrl: `https://jobs.example.com/listings/${id.replace(/^example:/, '')}`,
    applyUrl: 'https://job-boards.greenhouse.io/stripe/jobs/7000001?gh_jid=7000001',
    easyApply: false,
    ...overrides,
  };
}

export function judged(overrides: Partial<JudgedJob> = {}): JudgedJob {
  const base = listing(overrides);
  return {
    ...base,
    fingerprint: listingFingerprint(base),
    verdict: 'strong',
    reason: 'TypeScript and Postgres web services at 2 years, NYC hybrid.',
    repeatOf: null,
    checkId: 'check-earlier',
    judgedAt: '2026-10-13T15:00:00.000Z',
    review: null,
    ...overrides,
  };
}
