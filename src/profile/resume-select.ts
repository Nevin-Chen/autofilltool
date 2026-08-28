import type { ResumeLibrary, ResumeVariant } from './schema';

const SHARED_ATS_HOSTS: ReadonlyArray<RegExp> = [
  /(^|\.)greenhouse\.io$/i,
  /(^|\.)lever\.co$/i,
  /(^|\.)ashbyhq\.com$/i,
  /(^|\.)workable\.com$/i,
];

export function companyKeyFromUrl(url: URL | string): string {
  let u: URL;
  try {
    u = typeof url === 'string' ? new URL(url) : url;
  } catch {
    return '';
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';

  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  if (!host) return '';
  if (!SHARED_ATS_HOSTS.some((re) => re.test(host))) return host;

  const segment = u.pathname.split('/').filter(Boolean)[0]?.toLowerCase() ?? '';
  if (!segment) return host;

  if (segment === 'embed') {
    const forParam = u.searchParams.get('for')?.trim().toLowerCase();
    return forParam ? `${host}/${forParam}` : host;
  }
  return `${host}/${segment}`;
}

export function variantById(
  library: ResumeLibrary,
  id: string | null | undefined,
): ResumeVariant | null {
  if (!id) return null;
  return library.variants.find((v) => v.id === id) ?? null;
}

export function resolveResumeVariant(
  library: ResumeLibrary,
  companyChoices: Readonly<Record<string, string>>,
  companyKey: string,
): ResumeVariant | null {
  const remembered = companyKey ? variantById(library, companyChoices[companyKey]) : null;
  return remembered ?? defaultVariant(library);
}

export function defaultVariant(library: ResumeLibrary): ResumeVariant | null {
  return variantById(library, library.activeId) ?? library.variants[0] ?? null;
}

export function withCompanyChoice(
  choices: Readonly<Record<string, string>>,
  companyKey: string,
  variantId: string | null,
  library: ResumeLibrary,
): Record<string, string> {
  const next = { ...choices };
  if (!companyKey) return next;
  if (!variantId || variantId === defaultVariant(library)?.id) {
    delete next[companyKey];
  } else {
    next[companyKey] = variantId;
  }
  return next;
}

export function pruneCompanyChoices(
  choices: Readonly<Record<string, string>>,
  library: ResumeLibrary,
): Record<string, string> {
  const live = new Set(library.variants.map((v) => v.id));
  const next: Record<string, string> = {};
  for (const [key, id] of Object.entries(choices)) {
    if (live.has(id)) next[key] = id;
  }
  return next;
}
