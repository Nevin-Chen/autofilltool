import type { JobListing } from '../schema';
import { hiringCafeSource } from './hiringcafe';
import { linkedInSource } from './linkedin';

export type ListingDetails = {
  description: string | null;
  applyUrl: string | null;
  easyApply: boolean;
};

export type BrowsingLimits = {
  minGapMs: number;
  maxGapMs: number;
  minClickGapMs: number;
  maxClickGapMs: number;
  maxSearchPages: number;
  maxDetailReads: number;
};

export type JobSource = {
  id: string;
  matches: (url: URL) => boolean;
  postedTodayOnly: boolean;
  limits: BrowsingLimits;
  searchPageUrl: (searchUrl: string, pageIndex: number) => string;
  readPage: () => unknown;
  toListings: (raw: unknown) => JobListing[] | null;
  hasMorePages: (raw: unknown) => boolean;
  isBlocked: (raw: unknown) => boolean;
  unreadCards?: (raw: unknown) => number;
  readSelected?: (listingId: string) => unknown;
  readListingPage?: () => unknown;
  toDetails?: (raw: unknown) => ListingDetails | null;
};

export const JOB_SOURCES: readonly JobSource[] = [linkedInSource, hiringCafeSource];

export function sourceForUrl(raw: string): JobSource | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  return JOB_SOURCES.find((source) => source.matches(url)) ?? null;
}
