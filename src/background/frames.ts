/**
 * Multi-frame fill plumbing — pure helpers, no chrome.* calls.
 *
 * Companies embed ATS application forms into their own career pages in two
 * shapes:
 *
 *  1. iframe — `<iframe src="https://boards.greenhouse.io/embed/…">`. The
 *     form HTML lives on the ATS host inside the frame; the parent page is
 *     on the company's own domain.
 *  2. JS-rendered — Greenhouse's `embed.js` ultimately also injects an
 *     iframe in practice; the visible behaviour is the same.
 *
 * Our content script can't reach into a cross-origin iframe from the
 * parent, so the only way to fill an embedded form is to inject the
 * content script *into the iframe* and message it directly. Chrome's
 * `chrome.tabs.sendMessage(tabId, msg)` only hits the top frame unless we
 * pass an explicit `frameId`, so the background has to enumerate frames
 * and broadcast.
 *
 * `pickTargetFrames` decides which frames should receive FILL_PAGE: if any
 * subframe is an ATS host, fill only those (avoids accidentally filling
 * the company's newsletter signup on the parent page); otherwise fall back
 * to the top frame only.
 *
 * `mergeFillResponses` combines the per-frame results into the single
 * FillPageResponse the popup expects.
 */

import type { FillPageResponse, FillActionWire } from '@/types/messages';

/**
 * Hosts whose pages we recognise as ATS application forms. Used both for
 * frame targeting and for picking the "best" adapter when responses come
 * from multiple frames. Anything matching this list is preferred over a
 * generic-adapter fill on the parent frame.
 */
const ATS_HOST_PATTERNS: ReadonlyArray<RegExp> = [
  /(^|\.)greenhouse\.io$/i,
  /(^|\.)lever\.co$/i,
  /(^|\.)ashbyhq\.com$/i,
  /(^|\.)myworkdayjobs\.com$/i,
];

/**
 * One ATS hint we can guess by looking at a frame's DOM. `null` means the
 * frame didn't look like any platform we know how to drive.
 */
export type AtsHint = 'greenhouse' | 'lever' | 'ashby' | 'workday' | null;

export type FrameInfo = {
  /** chrome.scripting frameId — 0 is the top frame. */
  frameId: number;
  /** location.href as the frame sees it. May be 'about:blank', etc. */
  url: string;
  /**
   * Platform guess from a DOM probe inside the frame. Belt-and-suspenders
   * for URL-based targeting: ATS hosts occasionally change subdomains
   * (boards.greenhouse.io → job-boards.greenhouse.io), or a frame may be
   * `about:blank` while still containing an embedded form's HTML.
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
 * DOM probe — runs in the page's isolated world via
 * chrome.scripting.executeScript, so it must be self-contained (no
 * imports). Detects which ATS platform's markup a frame contains.
 *
 * Exported for the background to inject and for unit tests to call on a
 * jsdom Document.
 *
 * Returns `null` when nothing matches — the caller will then fall back to
 * URL-based targeting.
 *
 * Why these selectors (Greenhouse, the one we know best):
 *   - `form#application-form` — legacy boards.greenhouse.io form root.
 *   - `#grnhse_app`           — wrapper div the embed JS creates on parent
 *                               pages (`<div id="grnhse_app"><iframe
 *                               id="grnhse_iframe" ...></iframe></div>`).
 *   - `#grnhse_iframe`        — the iframe id itself, in case we're
 *                               inspecting from the parent.
 *   - `input[name="first_name"]` + `input[name="last_name"]` together —
 *                               new-redesign signature; both must be
 *                               present to avoid matching unrelated forms.
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
  // Lever — `data-qa="application-form"` is the stable marker; URL inputs
  // like `urls[LinkedIn]` confirm the legacy form structure.
  if (
    doc.querySelector('[data-qa="application-form"]') ||
    doc.querySelector('input[name="resume"][type="file"]')
  ) {
    // Be careful: a `name="resume"` file input alone isn't enough — many
    // ATSes use that. Only count it as Lever when paired with the qa hook.
    if (doc.querySelector('[data-qa="application-form"]')) return 'lever';
  }
  // Ashby — every field is in `[data-testid="FieldEntry"]`.
  if (doc.querySelector('[data-testid="FieldEntry"]')) {
    return 'ashby';
  }
  // Workday — uses `data-automation-id` heavily; not implemented yet
  // (step 7), but recognising the marker now means we'll route to it
  // automatically when the adapter ships.
  if (doc.querySelector('[data-automation-id]')) {
    return 'workday';
  }
  return null;
}

/**
 * Choose which frames in the tab should receive FILL_PAGE.
 *
 * Priority order:
 *  1. Frames whose DOM probe matched a platform (`atsHint != null`). The
 *     probe is the most reliable signal — it doesn't care what subdomain
 *     the iframe is on, and survives weirdness like `about:blank` frames
 *     that have content written in via JS.
 *  2. Frames whose URL is a known ATS host. Belt-and-suspenders for cases
 *     where the probe was unable to run (e.g. cross-origin sandbox).
 *  3. Top frame only — the user is just trying the generic adapter on a
 *     regular page.
 *
 * Why the "ATS frames only when present" rule: if the user clicks Fill on
 * a company page that has a Greenhouse iframe AND a marketing newsletter
 * signup at the top, the generic adapter would fill the signup with the
 * user's email while the Greenhouse adapter fills the actual job form.
 * Targeting only the ATS frame keeps the intent clean.
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
 * Combine per-frame FillPageResponse values into a single response shaped
 * the way the popup already consumes. Sums counts, concatenates actions,
 * and picks the adapter id from the frame that contributed the most filled
 * fields (ties broken by "not generic" first, then by adapter id ordering
 * in the input).
 *
 * If every frame errored, returns the first error (with a hint about how
 * many frames were tried, since "Could not establish connection" on a
 * single hidden iframe is a common false positive).
 *
 * If no frames responded at all, returns a synthetic ok-with-zero rather
 * than an error: the user clicked Fill, the script ran somewhere, nothing
 * matched. The pill on the page will say `0 filled` and that's the right
 * UX.
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
          actions: [],
        },
      };
    }
    // All frames failed. The most actionable error is the one that didn't
    // come from a missing listener — "Could not establish connection" is
    // the standard Chrome message when a frame had no content script.
    const meaningful = errs.find(
      (e) => !/Could not establish connection|Receiving end does not exist/i.test(e.error),
    );
    const chosen = meaningful ?? errs[0]!;
    return chosen;
  }

  // Pick the "winner" frame for adapterId — most filled, then non-generic
  // tiebreak, then first wins.
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
  const actions: FillActionWire[] = [];
  for (const r of oks) {
    filled += r.value.filled;
    skipped += r.value.skipped;
    failed += r.value.failed;
    total += r.value.total;
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
      actions,
    },
  };
}
