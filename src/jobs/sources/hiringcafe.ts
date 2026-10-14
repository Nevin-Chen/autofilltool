import type { JobListing } from '../schema';
import type { JobSource, ListingDetails } from './index';

const HIRING_CAFE_HOSTS = new Set(['hiringcafe.com', 'www.hiringcafe.com', 'hiring.cafe', 'www.hiring.cafe']);

export function readHiringCafePage(): unknown {
  const script = document.getElementById('__NEXT_DATA__');
  if (!script?.textContent) return null;
  try {
    return JSON.parse(script.textContent)?.props?.pageProps?.ssrHits ?? null;
  } catch {
    return null;
  }
}

export function readHiringCafeJobPage(): unknown {
  const htmlToText = (html: string): string => {
    const withBreaks = html.replace(/<(br|\/p|\/li|\/h[1-6]|\/div|\/ul|\/ol|\/tr)\b[^>]*>/gi, '\n');
    const text = new DOMParser().parseFromString(withBreaks, 'text/html').body.textContent ?? '';
    return text.replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*/g, '\n\n').trim();
  };
  const longestDescription = (root: unknown): string => {
    let best = '';
    const stack: unknown[] = [root];
    let visited = 0;
    while (stack.length > 0 && visited < 50_000) {
      const node = stack.pop();
      visited++;
      if (Array.isArray(node)) {
        stack.push(...node);
      } else if (node && typeof node === 'object') {
        for (const [key, value] of Object.entries(node)) {
          if (typeof value === 'string' && /description/i.test(key) && value.length > best.length) {
            best = value;
          } else if (value && typeof value === 'object') {
            stack.push(value);
          }
        }
      }
    }
    return best;
  };

  const script = document.getElementById('__NEXT_DATA__');
  if (script?.textContent) {
    try {
      const fromData = htmlToText(longestDescription(JSON.parse(script.textContent)));
      if (fromData.length >= 400) return fromData;
    } catch {
    }
  }
  const main = document.querySelector('main') as HTMLElement | null;
  const fromPage = (main?.innerText || main?.textContent || '').trim();
  return fromPage.length >= 400 ? fromPage : null;
}

export function hiringCafeDetails(raw: unknown): ListingDetails | null {
  const description = typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : null;
  return description ? { description, applyUrl: null, easyApply: false } : null;
}

export function hiringCafeListings(raw: unknown): JobListing[] | null {
  if (!Array.isArray(raw)) return null;
  const cards = new Set<string>();
  const listings: JobListing[] = [];
  for (const hit of raw) {
    if (!isRecord(hit) || hit.is_expired === true) continue;
    const card = text(hit.collapse_key) || text(hit.objectID);
    if (!card || cards.has(card)) continue;
    cards.add(card);
    const listing = toListing(hit);
    if (listing) listings.push(listing);
  }
  return listings;
}

function toListing(hit: Record<string, unknown>): JobListing | null {
  const job = record(hit.v5_processed_job_data);
  const requisitionId = text(hit.requisition_id);
  const id = requisitionId || text(hit.objectID);
  const title = text(record(hit.job_information).title);
  const postedAt = publishedAt(job, hit);
  if (!id || !title || !postedAt) return null;
  const applyUrl = text(hit.apply_url) || null;
  return {
    id: `hiringcafe:${id}`,
    source: 'hiringcafe',
    title,
    company: text(job.company_name) || text(record(hit.enriched_company_data).name),
    location: text(job.formatted_workplace_location),
    workplace: text(job.workplace_type) || null,
    category: text(job.job_category) || null,
    minYoe: job.is_min_industry_and_role_yoe_not_mentioned === true ? null : numberOrNull(job.min_industry_and_role_yoe),
    pay: formatPay(job),
    postedAt,
    requirements: text(job.requirements_summary),
    tools: Array.isArray(job.technical_tools) ? job.technical_tools.filter((t): t is string => typeof t === 'string') : [],
    listingUrl: requisitionId ? `https://hiringcafe.com/job/${requisitionId}` : (applyUrl ?? ''),
    applyUrl,
    easyApply: false,
  };
}

function publishedAt(job: Record<string, unknown>, hit: Record<string, unknown>): string {
  const estimated = text(job.estimated_publish_date);
  if (estimated && !Number.isNaN(Date.parse(estimated))) return estimated;
  const incarnation = numberOrNull(hit.job_incarnation);
  return incarnation ? new Date(incarnation).toISOString() : '';
}

function formatPay(job: Record<string, unknown>): string | null {
  const yearly = [numberOrNull(job.yearly_min_compensation), numberOrNull(job.yearly_max_compensation)].filter(isPositive);
  if (yearly.length > 0) return yearly.map((v) => `$${Math.round(v / 1000)}k`).join('-');
  const hourly = [numberOrNull(job.hourly_min_compensation), numberOrNull(job.hourly_max_compensation)].filter(isPositive);
  if (hourly.length > 0) return `${hourly.map((v) => `$${v}`).join('-')}/hr`;
  return null;
}

function isPositive(value: number | null): value is number {
  return value !== null && value > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export const hiringCafeSource: JobSource = {
  id: 'hiringcafe',
  matches: (url) => HIRING_CAFE_HOSTS.has(url.hostname),
  postedTodayOnly: true,
  limits: { minGapMs: 0, maxGapMs: 0, maxSearchPages: 1, maxListingPages: 60 },
  searchPageUrl: (searchUrl) => searchUrl,
  readPage: readHiringCafePage,
  toListings: hiringCafeListings,
  hasMorePages: () => false,
  isBlocked: () => false,
  readListingPage: readHiringCafeJobPage,
  toDetails: hiringCafeDetails,
};
