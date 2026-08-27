import type { FillPageResponse, FillActionWire } from '@/types/messages';

const ATS_HOST_PATTERNS: ReadonlyArray<RegExp> = [
  /(^|\.)greenhouse\.io$/i,
  /(^|\.)lever\.co$/i,
  /(^|\.)ashbyhq\.com$/i,
  /(^|\.)myworkdayjobs\.com$/i,
  /(^|\.)applytojob\.com$/i,
];

export type AtsHint =
  | 'greenhouse'
  | 'lever'
  | 'ashby'
  | 'workday'
  | 'jazzhr'
  | null;

export type FrameInfo = {
  frameId: number;
  url: string;
  atsHint: AtsHint;
};

export function isAtsFrameUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  return ATS_HOST_PATTERNS.some((re) => re.test(u.hostname));
}

export function probeAtsHint(doc: Document): AtsHint {
  if (
    doc.getElementById('grnhse_app') ||
    doc.getElementById('grnhse_iframe') ||
    doc.querySelector('form#application-form') ||
    (doc.querySelector('input[name="first_name"]') &&
      doc.querySelector('input[name="last_name"]') &&
      doc.querySelector('input[name="email"]'))
  ) {
    return 'greenhouse';
  }
  if (
    doc.querySelector('[data-qa="application-form"]') ||
    doc.querySelector('input[name="resume"][type="file"]')
  ) {
    if (doc.querySelector('[data-qa="application-form"]')) return 'lever';
  }
  if (doc.querySelector('[data-testid="FieldEntry"]')) {
    return 'ashby';
  }
  if (
    doc.querySelector(
      'form[data-test="form_submit_new_resume"], input[name^="resumator-"]',
    )
  ) {
    return 'jazzhr';
  }
  if (doc.querySelector('[data-automation-id]')) {
    return 'workday';
  }
  return null;
}

export function pickTargetFrames(frames: ReadonlyArray<FrameInfo>): FrameInfo[] {
  if (frames.length === 0) return [];
  const probed = frames.filter((f) => f.atsHint !== null);
  if (probed.length > 0) return probed.slice();
  const byUrl = frames.filter((f) => isAtsFrameUrl(f.url));
  if (byUrl.length > 0) return byUrl.slice();
  const top = frames.find((f) => f.frameId === 0);
  return top ? [top] : [];
}

export function mergeFillResponses(
  responses: ReadonlyArray<FillPageResponse>,
): FillPageResponse {
  const oks = responses.filter(
    (r): r is Extract<FillPageResponse, { ok: true }> => r.ok,
  );
  const errs = responses.filter(
    (r): r is Extract<FillPageResponse, { ok: false }> => !r.ok,
  );

  if (oks.length === 0) {
    if (errs.length === 0) {
      return {
        ok: true,
        value: {
          adapterId: 'generic',
          filled: 0,
          skipped: 0,
          failed: 0,
          total: 0,
          fieldsDetected: 0,
          actions: [],
        },
      };
    }
    const meaningful = errs.find(
      (e) => !/Could not establish connection|Receiving end does not exist/i.test(e.error),
    );
    const chosen = meaningful ?? errs[0]!;
    return chosen;
  }

  const winner = [...oks].sort((a, b) => {
    if (a.value.filled !== b.value.filled) return b.value.filled - a.value.filled;
    const aGeneric = a.value.adapterId === 'generic' ? 1 : 0;
    const bGeneric = b.value.adapterId === 'generic' ? 1 : 0;
    if (aGeneric !== bGeneric) return aGeneric - bGeneric;
    return 0;
  })[0]!;

  let filled = 0;
  let skipped = 0;
  let failed = 0;
  let total = 0;
  let fieldsDetected = 0;
  const actions: FillActionWire[] = [];
  for (const r of oks) {
    filled += r.value.filled;
    skipped += r.value.skipped;
    failed += r.value.failed;
    total += r.value.total;
    fieldsDetected += r.value.fieldsDetected;
    actions.push(...r.value.actions);
  }

  return {
    ok: true,
    value: {
      adapterId: winner.value.adapterId,
      filled,
      skipped,
      failed,
      total,
      fieldsDetected,
      actions,
    },
  };
}
