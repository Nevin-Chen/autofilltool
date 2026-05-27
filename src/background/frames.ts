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

export type FrameInfo = {
  /** chrome.scripting frameId — 0 is the top frame. */
  frameId: number;
  /** location.href as the frame sees it. May be 'about:blank', etc. */
  url: string;
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
 * Choose which frames in the tab should receive FILL_PAGE.
 *
 * Rules:
 *  - If any frame is an ATS host → target every such frame and ONLY those.
 *    This avoids the case where a user clicks Fill on company.com which
 *    has a Greenhouse iframe AND a marketing newsletter signup at the
 *    top — without this rule, the generic adapter would fill the
 *    newsletter signup with the user's email and the Greenhouse adapter
 *    would fill the actual job form. Targeting ATS frames keeps the
 *    intent clean.
 *  - Otherwise → top frame only (a normal direct-on-ATS page, or a
 *    page where the user is just trying the generic adapter).
 *  - If somehow there is no frame info at all (defensive) → empty list.
 */
export function pickTargetFrames(frames: ReadonlyArray<FrameInfo>): FrameInfo[] {
  if (frames.length === 0) return [];
  const ats = frames.filter((f) => isAtsFrameUrl(f.url));
  if (ats.length > 0) return ats.slice();
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
