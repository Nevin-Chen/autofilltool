export type JobContext = {
  company: string;
  role: string;
  jobUrl: string;
  jobDescription: string;
};

export function extractJobContext(doc: Document, url: URL): JobContext {
  return {
    company: extractCompany(doc, url),
    role: extractRole(doc),
    jobUrl: stripTrackingParams(url).toString(),
    jobDescription: '',
  };
}

function extractRole(doc: Document): string {
  const fromLd = readJobPostingLd(doc);
  if (fromLd?.title) return fromLd.title;

  const og = metaContent(doc, 'meta[property="og:title"]');
  if (og) return cleanTitle(og);
  const tw = metaContent(doc, 'meta[name="twitter:title"]');
  if (tw) return cleanTitle(tw);

  const selectors = [
    'h1.posting-headline h2',
    '.posting-headline h2',
    'h1[data-automation-id="jobPostingHeader"]',
    'h1[data-ui="job-title"]',
    '[data-testid="job-title"]',
    '[data-test="jobTitle"]',
    '.job-title',
    'h1.app-title',
    'h1',
  ];
  for (const sel of selectors) {
    const t = textOf(doc.querySelector(sel));
    if (t) return cleanTitle(t);
  }

  const title = doc.title;
  const split = title.match(/^(.+?)\s*[|\-–—]\s*.+$/);
  return cleanTitle(split?.[1] ?? title);
}

function extractCompany(doc: Document, url: URL): string {
  const fromLd = readJobPostingLd(doc);
  if (fromLd?.company) return fromLd.company;

  const fromAts = companyFromAtsUrl(url);
  if (fromAts) return fromAts;

  const og = metaContent(doc, 'meta[property="og:site_name"]');
  if (og) return og.trim();

  const t = doc.title;
  const m = t.match(/^(.+?)\s*[|\-–—]\s*(.+)$/);
  if (m?.[2]) return cleanTitle(m[2]);

  return '';
}

function companyFromAtsUrl(url: URL): string | null {
  if (url.hostname.endsWith('greenhouse.io')) {
    if (url.pathname.startsWith('/embed/')) {
      const forParam = url.searchParams.get('for');
      return forParam ? titleCase(forParam.replace(/-/g, ' ')) : null;
    }
    const m = url.pathname.match(/^\/([^/]+)\//);
    if (m?.[1]) return titleCase(m[1].replace(/-/g, ' '));
  }
  if (url.hostname.endsWith('lever.co')) {
    const m = url.pathname.match(/^\/([^/]+)\//);
    if (m?.[1]) return titleCase(m[1].replace(/-/g, ' '));
  }
  if (url.hostname.endsWith('ashbyhq.com')) {
    const m = url.pathname.match(/^\/([^/]+)\//);
    if (m?.[1]) return titleCase(m[1].replace(/-/g, ' '));
  }
  if (url.hostname.endsWith('myworkdayjobs.com')) {
    const sub = url.hostname.split('.')[0];
    if (sub) return titleCase(sub.replace(/-/g, ' '));
  }
  if (url.hostname.endsWith('applytojob.com')) {
    const sub = url.hostname.split('.')[0];
    if (sub) return titleCase(sub.replace(/-/g, ' '));
  }
  if (url.hostname.endsWith('workable.com')) {
    const m = url.pathname.match(/^\/([^/]+)\//);
    if (m?.[1]) return titleCase(m[1].replace(/-/g, ' '));
  }
  return null;
}

function readJobPostingLd(doc: Document): { title?: string; company?: string } | null {
  const scripts = doc.querySelectorAll<HTMLScriptElement>(
    'script[type="application/ld+json"]',
  );
  for (const s of Array.from(scripts)) {
    const raw = s.textContent;
    if (!raw) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    const job = findJobPosting(parsed);
    if (!job) continue;
    const title = typeof job.title === 'string' ? job.title.trim() : undefined;
    let company: string | undefined;
    const hiring = (job as { hiringOrganization?: unknown }).hiringOrganization;
    if (typeof hiring === 'string') company = hiring.trim();
    else if (
      hiring &&
      typeof hiring === 'object' &&
      typeof (hiring as { name?: unknown }).name === 'string'
    ) {
      company = (hiring as { name: string }).name.trim();
    }
    return { ...(title ? { title } : {}), ...(company ? { company } : {}) };
  }
  return null;
}

type Loose = { '@type'?: unknown; title?: unknown; hiringOrganization?: unknown };

function findJobPosting(value: unknown): Loose | null {
  if (!value || typeof value !== 'object') return null;
  if (Array.isArray(value)) {
    for (const v of value) {
      const hit = findJobPosting(v);
      if (hit) return hit;
    }
    return null;
  }
  const obj = value as { '@type'?: unknown; '@graph'?: unknown };
  if (obj['@type'] === 'JobPosting') return obj as Loose;
  if (Array.isArray(obj['@graph'])) {
    return findJobPosting(obj['@graph']);
  }
  return null;
}

function metaContent(doc: Document, selector: string): string {
  const el = doc.querySelector(selector);
  const c = el?.getAttribute('content') ?? '';
  return c.trim();
}

function textOf(el: Element | null): string {
  return (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function cleanTitle(raw: string): string {
  return raw
    .replace(/^\s*(apply for|apply to|application for|careers?\s*[-:])\s+/i, '')
    .trim();
}

function titleCase(s: string): string {
  return s
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

function stripTrackingParams(url: URL): URL {
  const clean = new URL(url.toString());
  const drop = new Set([
    'utm_source',
    'utm_medium',
    'utm_campaign',
    'utm_content',
    'utm_term',
    'gh_src',
    'gh_jid',
    'src',
    'lever-source',
  ]);
  for (const k of Array.from(clean.searchParams.keys())) {
    if (drop.has(k)) clean.searchParams.delete(k);
  }
  return clean;
}
