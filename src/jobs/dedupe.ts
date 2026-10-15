import type { JobListing, JudgedJob } from './schema';

export type JudgeCandidate = {
  listing: JobListing;
  fingerprint: string;
  sameTitleAs: JobListing | null;
};

export type ListingSelection = {
  candidates: JudgeCandidate[];
  postedToday: number;
  alreadySeen: number;
  identicalRepeats: number;
};

export function localDateKey(value: string | number | Date): string {
  return new Date(value).toLocaleDateString('en-CA');
}

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function titleCompanyKey(listing: Pick<JobListing, 'title' | 'company'>): string {
  return `${normalize(listing.title)} | ${normalize(listing.company)}`;
}

export function listingFingerprint(
  listing: Pick<JobListing, 'title' | 'company' | 'location' | 'requirements'>,
): string {
  return fnv1a(
    [titleCompanyKey(listing), normalize(listing.location), normalize(listing.requirements)].join(' | '),
  );
}

function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function selectNewListings(
  listings: readonly JobListing[],
  judged: readonly JudgedJob[],
  today: string,
): ListingSelection {
  const judgedIds = new Set(judged.map((job) => job.id));
  const knownFingerprints = new Set(judged.map((job) => job.fingerprint));
  const byTitle = new Map<string, JobListing>();
  for (const job of judged) {
    const key = titleCompanyKey(job);
    if (!byTitle.has(key)) byTitle.set(key, job);
  }

  const listingIds = new Set<string>();
  const postedToday = listings.filter((listing) => {
    if (listingIds.has(listing.id)) return false;
    listingIds.add(listing.id);
    return localDateKey(listing.postedAt) === today;
  });

  let alreadySeen = 0;
  let identicalRepeats = 0;
  const candidates: JudgeCandidate[] = [];
  for (const listing of postedToday) {
    if (judgedIds.has(listing.id)) {
      alreadySeen++;
      continue;
    }
    const fingerprint = listingFingerprint(listing);
    if (knownFingerprints.has(fingerprint)) {
      identicalRepeats++;
      continue;
    }
    knownFingerprints.add(fingerprint);
    const key = titleCompanyKey(listing);
    const sameTitleAs = byTitle.get(key) ?? null;
    if (!sameTitleAs) byTitle.set(key, listing);
    candidates.push({ listing, fingerprint, sameTitleAs });
  }

  return { candidates, postedToday: postedToday.length, alreadySeen, identicalRepeats };
}
