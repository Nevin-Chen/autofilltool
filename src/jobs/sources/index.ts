import type { JobListing } from '../schema';
import { hiringCafeSource } from './hiringcafe';

export type JobSource = {
  id: string;
  matches: (url: URL) => boolean;
  readPage: () => unknown;
  toListings: (raw: unknown) => JobListing[] | null;
  readListingPage?: () => unknown;
  toDescription?: (raw: unknown) => string | null;
};

export const JOB_SOURCES: readonly JobSource[] = [hiringCafeSource];

export function sourceForUrl(raw: string): JobSource | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  return JOB_SOURCES.find((source) => source.matches(url)) ?? null;
}
