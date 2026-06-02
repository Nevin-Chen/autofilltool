/**
 * Multi-frame fill plumbing — pure helpers, no chrome.* calls.
 *
 * Companies embed ATS forms as cross-origin iframes, which the parent's
 * content script can't reach. So the background injects the content script
 * into each frame and messages it by explicit frameId. pickTargetFrames
 * chooses which frames get FILL_PAGE (ATS frames only when present, so we
 * don't fill the parent page's newsletter signup); mergeFillResponses folds
 * the per-frame results into the single FillPageResponse the popup expects.
 */

import type { FillPageResponse, FillActionWire } from '@/types/messages';

/** ATS hosts — drives frame targeting and the "best adapter" tiebreak. */
const ATS_HOST_PATTERNS: ReadonlyArray<RegExp> = [
  /(^|\.)greenhouse\.io$/i,
  /(^|\.)lever\.co$/i,
  /(^|\.)ashbyhq\.com$/i,
  /(^|\.)myworkdayjobs\.com$/i,
];

/** Platform guessed from a frame's DOM; `null` = nothing we can drive. */
export type AtsHint = 'greenhouse' | 'lever' | 'ashby' | 'workday' | null;

export type FrameInfo = {
  /** chrome.scripting frameId — 0 is the top frame. */
  frameId: number;
  /** location.href as the frame sees it. May be 'about:blank', etc. */
  url: string;
  /**
   * DOM-probe platform guess. Backs up URL targeting: ATS hosts change
   * subdomains, and frames can be about:blank with JS-written form HTML.
   */
  atsHint: AtsHint;
};

/** True iff the URL's hostname matches one of the recognised ATS hosts. */
export function isAtsFrameUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  return ATS_HOST_PATTERNS.some((re) => re.test(u.hostname));
}

/**
 * Detect which ATS platform's markup a frame contains. Runs in the page's
 * isolated world via executeScript, so it must be self-contained (no
 * imports); also called by unit tests on a jsdom Document. Returns `null`
 * when nothing matches, so the caller falls back to URL-based targeting.
 */
export function probeAtsHint(doc: Document): AtsHint {
  // Greenhouse — order matters; cheaper checks first.
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
  // Lever — `data-qa="application-form"` is the stable marker. A bare
  // `name="resume"` file input isn't enough (many ATSes use it).
  if (
    doc.querySelector('[data-qa="application-form"]') ||
    doc.querySelector('input[name="resume"][type="file"]')
  ) {
    if (doc.querySelector('[data-qa="application-form"]')) return 'lever';
  }
  // Ashby — every field is in `[data-testid="FieldEntry"]`.
  if (doc.querySelector('[data-testid="FieldEntry"]')) {
    return 'ashby';
  }
  // Workday — `data-automation-id` everywhere.
  if (doc.querySelector('[data-automation-id]')) {
    return 'workday';
  }
  return null;
}

/**
 * Choose which frames get FILL_PAGE, in priority order: probed ATS frames
 * first (most reliable — subdomain- and about:blank-proof), then frames on
 * a known ATS host, else the top frame only. Targeting ATS frames only when
 * present stops the generic adapter from filling a parent-page newsletter
 * signup alongside the real job form.
 */
export function pickTargetFrames(frames: ReadonlyArray<FrameInfo>): FrameInfo[] {
  if (frames.length === 0) return [];
  const probed = frames.filter((f) => f.atsHint !== null);
  if (probed.length > 0) return probed.slice();
  const byUrl = frames.filter((f) => isAtsFrameUrl(f.url));
  if (byUrl.length > 0) return byUrl.slice();
  const top = frames.find((f) => f.frameId === 0);
  return top ? [top] : [];
}

/**
 * Fold per-frame responses into one. Sums counts, concatenates actions, and
 * takes adapterId from the frame that filled the most (non-generic
 * tiebreak). All frames errored → return the most meaningful error (skipping
 * the "Could not establish connection" noise from empty hidden iframes). No
 * responses at all → synthetic ok-with-zero, so the pill just shows 0 filled.
 */
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
    // Prefer an error that isn't Chrome's "no content script in this frame" noise.
    const meaningful = errs.find(
      (e) => !/Could not establish connection|Receiving end does not exist/i.test(e.error),
    );
    const chosen = meaningful ?? errs[0]!;
    return chosen;
  }

  // Winner for adapterId: most filled, non-generic tiebreak, then first.
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
