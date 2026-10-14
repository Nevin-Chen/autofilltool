import type { JobListing } from '../schema';
import type { JobSource, ListingDetails } from './index';

export const LINKEDIN_PAGE_SIZE = 25;

const LINKEDIN_HOSTS = new Set(['linkedin.com', 'www.linkedin.com']);
const SEARCH_PATH_RE = /^\/jobs\/(search|search-results)\/?$/;

export async function readLinkedInSearchPage(): Promise<unknown> {
  if (/^\/(checkpoint|authwall|login|uas|signup)(\/|$)/.test(location.pathname)) return { blocked: true };
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const cardSelector = '[componentkey^="job-card-component-ref-"]';
  const textLines = (el: Element): string[] => {
    const inner = (el as HTMLElement).innerText;
    if (typeof inner === 'string' && inner.trim()) {
      return inner.split('\n').map((line) => line.trim()).filter(Boolean);
    }
    const lines: string[] = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const text = walker.currentNode.textContent?.trim();
      if (text) lines.push(text);
    }
    return lines;
  };
  const cardElements = (): Map<string, Element> => {
    const byId = new Map<string, Element>();
    for (const el of document.querySelectorAll(cardSelector)) {
      const id = (el.getAttribute('componentkey') ?? '').replace('job-card-component-ref-', '');
      if (/^\d+$/.test(id) && !byId.has(id)) byId.set(id, el);
    }
    return byId;
  };

  let lastCount = -1;
  let stableSince = Date.now();
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const count = cardElements().size;
    if (count !== lastCount) {
      lastCount = count;
      stableSince = Date.now();
    } else if (count > 0 && Date.now() - stableSince >= 1_500) {
      break;
    }
    const pageText = document.body?.textContent ?? '';
    if (count === 0 && /No matching jobs found|No results found/i.test(pageText)) break;
    await sleep(250);
  }

  const elements = cardElements();
  for (const el of elements.values()) {
    if (textLines(el).length === 0) {
      el.scrollIntoView({ block: 'center' });
      await sleep(400);
    }
  }

  const cards = [...elements.entries()].map(([id, el]) => ({ id, lines: textLines(el) }));
  const next = [...document.querySelectorAll('button')].find(
    (button) => (button.getAttribute('aria-label') || button.textContent || '').trim() === 'Next',
  );
  const hasNext = !!next && !next.disabled && next.getAttribute('aria-disabled') !== 'true';
  return { blocked: false, cards, hasNext };
}

export async function readLinkedInJobPage(): Promise<unknown> {
  if (/^\/(checkpoint|authwall|login|uas|signup)(\/|$)/.test(location.pathname)) return { blocked: true };
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const findBox = () =>
    document.querySelector('[componentkey*="AboutTheJob"] [data-testid="expandable-text-box"]') ??
    document.querySelector('[data-testid="expandable-text-box"]');
  const deadline = Date.now() + 15_000;
  while (!findBox() && Date.now() < deadline) await sleep(250);

  const textOf = (el: Element): string => {
    const inner = (el as HTMLElement).innerText;
    return (typeof inner === 'string' && inner.trim() ? inner : (el.textContent ?? '')).trim();
  };
  const box = findBox();
  let description = box ? textOf(box) : '';
  if (!description) {
    const heading = [...document.querySelectorAll('h2, h3')].find((h) => h.textContent?.trim() === 'About the job');
    let container = heading?.parentElement ?? null;
    while (container && textOf(container).length < 400 && container.parentElement) container = container.parentElement;
    description = container ? textOf(container).replace(/^About the job\s*/, '') : '';
  }
  description = description.replace(/\s*…\s*more\s*$/i, '').trim();

  const applyLink = [...document.querySelectorAll('a[href*="/safety/go"]')].find((a) =>
    /apply/i.test(a.getAttribute('aria-label') || a.textContent || ''),
  );
  let applyUrl: string | null = null;
  if (applyLink) {
    try {
      applyUrl = new URL(applyLink.getAttribute('href') ?? '', location.href).searchParams.get('url');
    } catch {
      applyUrl = null;
    }
  }
  const easyApply = [...document.querySelectorAll('button, a')].some((el) =>
    /^Easy Apply\b/i.test((el.getAttribute('aria-label') || el.textContent || '').trim()),
  );
  return { blocked: false, description, applyUrl, easyApply };
}

export async function readLinkedInSelectedJob(listingId: string): Promise<unknown> {
  if (/^\/(checkpoint|authwall|login|uas|signup)(\/|$)/.test(location.pathname)) return { blocked: true };
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const jobId = listingId.replace(/^linkedin:/, '');
  const card =
    document.querySelector(`div[role="button"][componentkey="job-card-component-ref-${jobId}"]`) ??
    document.querySelector(`[componentkey="job-card-component-ref-${jobId}"]`);
  if (!card) return { missing: true };

  const descriptionSelector = `[componentkey="JobDetails_AboutTheJob_${jobId}"] [data-testid="expandable-text-box"]`;
  if (!document.querySelector(descriptionSelector)) {
    (card as HTMLElement).click();
    const deadline = Date.now() + 15_000;
    while (!document.querySelector(descriptionSelector) && Date.now() < deadline) await sleep(250);
  }
  const box = document.querySelector(descriptionSelector);
  if (!box) return { missing: true };

  const applyLink = () =>
    [...document.querySelectorAll('a[href*="/safety/go"]')].find((a) =>
      /apply/i.test(a.getAttribute('aria-label') || a.textContent || ''),
    );
  const easyApplyButton = () =>
    [...document.querySelectorAll('button, a')].find((el) =>
      /^Easy Apply\b/i.test((el.getAttribute('aria-label') || el.textContent || '').trim()),
    );
  const buttonsDeadline = Date.now() + 3_000;
  while (!applyLink() && !easyApplyButton() && Date.now() < buttonsDeadline) await sleep(200);

  const inner = (box as HTMLElement).innerText;
  const text = typeof inner === 'string' && inner.trim() ? inner : (box.textContent ?? '');
  const description = text.replace(/\s*…\s*more\s*$/i, '').trim();
  let applyUrl: string | null = null;
  const link = applyLink();
  if (link) {
    try {
      applyUrl = new URL(link.getAttribute('href') ?? '', location.href).searchParams.get('url');
    } catch {
      applyUrl = null;
    }
  }
  return { blocked: false, description, applyUrl, easyApply: !!easyApplyButton() };
}

type RawCard = { id: string; lines: string[] };

export function linkedInListings(raw: unknown, now: number = Date.now()): JobListing[] | null {
  if (!isRecord(raw) || raw.blocked === true || !Array.isArray(raw.cards)) return null;
  const listings: JobListing[] = [];
  for (const card of raw.cards) {
    if (!isRawCard(card)) continue;
    const listing = parseLinkedInCard(card, now);
    if (listing) listings.push(listing);
  }
  return listings;
}

const WORKPLACE_RE = /\s*\((On-site|Hybrid|Remote)\)\s*$/i;
const PAY_RE = /^\$[\d,.]+K?(?:\/(?:yr|hr))?(?:\s*-\s*\$[\d,.]+K?(?:\/(?:yr|hr))?)?$/i;
const POSTED_RE = /(\d+)\s+(minute|hour|day|week|month)s?\s+ago/i;
const UNIT_MS: Record<string, number> = {
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 604_800_000,
  month: 2_592_000_000,
};

export function parseLinkedInCard(card: RawCard, now: number): JobListing | null {
  const { id, lines } = card;
  if (!/^\d+$/.test(id) || lines.length < 3) return null;
  const title = cleanLabel(lines[0] ?? '');
  const rest = lines.slice(lines[1] === title ? 2 : 1);
  const company = rest[0] ?? '';
  const locationLine = rest[1] ?? '';
  if (!title) return null;
  const workplace = WORKPLACE_RE.exec(locationLine)?.[1] ?? null;
  const payLine = lines.find((line) => PAY_RE.test(line));
  return {
    id: `linkedin:${id}`,
    source: 'linkedin',
    title,
    company,
    location: locationLine.replace(WORKPLACE_RE, ''),
    workplace,
    category: null,
    minYoe: null,
    pay: payLine ? normalizePay(payLine) : null,
    postedAt: postedAt(lines, now),
    requirements: '',
    tools: [],
    listingUrl: `https://www.linkedin.com/jobs/view/${id}/`,
    applyUrl: null,
    easyApply: lines.some((line) => line === 'Easy Apply'),
  };
}

function cleanLabel(label: string): string {
  return label.replace(/^Selected,\s*/i, '').replace(/\s*\(Verified job\)\s*$/i, '').trim();
}

export function normalizePay(line: string): string {
  const hourly = /\/hr/i.test(line);
  const amounts = line
    .split(/\s*-\s*/)
    .map((part) => part.trim().replace(/\/(yr|hr)$/i, '').replace(/K$/i, 'k'));
  return hourly ? `${amounts.join('-')}/hr` : amounts.join('-');
}

function postedAt(lines: readonly string[], now: number): string {
  for (const line of lines) {
    const match = POSTED_RE.exec(line);
    if (match) return new Date(now - Number(match[1]) * UNIT_MS[match[2]!.toLowerCase()]!).toISOString();
  }
  return new Date(now).toISOString();
}

export function linkedInDetails(raw: unknown): ListingDetails | null {
  if (!isRecord(raw) || raw.blocked === true || raw.missing === true) return null;
  const description = typeof raw.description === 'string' && raw.description.trim() ? raw.description.trim() : null;
  const applyUrl = typeof raw.applyUrl === 'string' && /^https?:\/\//.test(raw.applyUrl) ? raw.applyUrl : null;
  return { description, applyUrl, easyApply: raw.easyApply === true };
}

export function linkedInSearchPageUrl(searchUrl: string, pageIndex: number): string {
  const url = new URL(searchUrl);
  url.searchParams.delete('currentJobId');
  if (pageIndex === 0) url.searchParams.delete('start');
  else url.searchParams.set('start', String(pageIndex * LINKEDIN_PAGE_SIZE));
  return url.toString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isRawCard(value: unknown): value is RawCard {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    Array.isArray(value.lines) &&
    value.lines.every((line) => typeof line === 'string')
  );
}

export const linkedInSource: JobSource = {
  id: 'linkedin',
  matches: (url) => LINKEDIN_HOSTS.has(url.hostname) && SEARCH_PATH_RE.test(url.pathname),
  postedTodayOnly: false,
  limits: {
    minGapMs: 3_000,
    maxGapMs: 8_000,
    minClickGapMs: 2_000,
    maxClickGapMs: 5_000,
    maxSearchPages: 10,
    maxDetailReads: 60,
  },
  searchPageUrl: linkedInSearchPageUrl,
  readPage: readLinkedInSearchPage,
  toListings: (raw) => linkedInListings(raw),
  hasMorePages: (raw) => isRecord(raw) && raw.hasNext === true && Array.isArray(raw.cards) && raw.cards.length > 0,
  isBlocked: (raw) => isRecord(raw) && raw.blocked === true,
  unreadCards: (raw) =>
    isRecord(raw) && Array.isArray(raw.cards) ? raw.cards.filter((card) => !isRawCard(card) || card.lines.length < 3).length : 0,
  readSelected: readLinkedInSelectedJob,
  readListingPage: readLinkedInJobPage,
  toDetails: linkedInDetails,
};
