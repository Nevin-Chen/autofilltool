import type { JobListing, JudgedJob } from '@/jobs/schema';
import type { JobSource } from '@/jobs/sources';
import { listingFingerprint } from '@/jobs/dedupe';

export const POSTED_TODAY = '2026-10-13T16:27:00.000Z';
export const POSTED_YESTERDAY = '2026-10-12T16:27:00.000Z';
export const NOW = new Date('2026-10-13T18:00:00.000Z');

export const SEARCH_URL = 'https://jobs.example.com/search?q=software+engineer&posted=today';

export const exampleBoard: JobSource = {
  id: 'example',
  matches: (url) => url.hostname === 'jobs.example.com',
  readPage: () => null,
  toListings: (raw) => (Array.isArray(raw) ? (raw as JobListing[]) : null),
  readListingPage: () => null,
  toDescription: (raw) => (typeof raw === 'string' && raw.trim() ? raw.trim() : null),
};

export function exampleSourceForUrl(raw: string): JobSource | null {
  try {
    return exampleBoard.matches(new URL(raw)) ? exampleBoard : null;
  } catch {
    return null;
  }
}

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
