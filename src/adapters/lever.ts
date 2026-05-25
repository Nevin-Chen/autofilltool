/**
 * Lever adapter. Lever-hosted application forms live at
 * `jobs.lever.co/<company>/<posting>/apply` and use predictable input `name`
 * attributes:
 *
 *   - `name="name"`             → full name
 *   - `name="email"`            → email
 *   - `name="phone"`            → phone
 *   - `name="org"`              → current company (we leave this; not in profile)
 *   - `name="resume"`           → resume file input
 *   - `name="urls[LinkedIn]"`   → LinkedIn URL
 *   - `name="urls[GitHub]"`     → GitHub URL
 *   - `name="urls[Portfolio]"`  → portfolio URL
 *   - `name="urls[Other]"`      → other URL
 *
 * Custom questions live inside `.application-question` blocks with their
 * own labels — handled by the shared heuristic classifier as a fallback.
 */

import type { PlatformAdapter, DetectedField, FieldKind } from './types';
import {
  classifyByHeuristics,
  collectContext,
  isFillable,
  attachResumeViaSlot,
  findResumeInput,
} from './_shared';

/** Exact-name matches for the canonical Lever fields. */
const NAME_MAP: ReadonlyArray<{ name: string; kind: FieldKind; confidence: number }> = [
  { name: 'name', kind: 'fullName', confidence: 0.99 },
  { name: 'email', kind: 'email', confidence: 0.99 },
  { name: 'phone', kind: 'phone', confidence: 0.99 },
  { name: 'urls[LinkedIn]', kind: 'linkedin', confidence: 0.99 },
  { name: 'urls[GitHub]', kind: 'github', confidence: 0.99 },
  { name: 'urls[Portfolio]', kind: 'portfolio', confidence: 0.99 },
  { name: 'urls[Other]', kind: 'otherLink', confidence: 0.95 },
];

export const leverAdapter: PlatformAdapter = {
  id: 'lever',
  name: 'Lever',
  matches: (url, doc) => {
    if (/(^|\.)lever\.co$/.test(url.hostname)) return true;
    // Some companies host Lever forms on their own subdomain — sniff the
    // characteristic class names Lever bundles.
    return !!doc.querySelector('form[action*="lever.co"], .lever-job-listing-page');
  },
  detectFields,
  fillResume,
};

function detectFields(root: Document): DetectedField[] {
  const out: DetectedField[] = [];
  const seen = new WeakSet<HTMLElement>();

  // 1. Canonical name-attribute fields.
  for (const { name, kind, confidence } of NAME_MAP) {
    const el = root.querySelector<HTMLElement>(`[name="${cssAttrEscape(name)}"]`);
    if (el instanceof HTMLElement && isFillable(el)) {
      const ctx = collectContext(el);
      out.push({ el, kind, label: ctx.label || name, confidence });
      seen.add(el);
    }
  }

  // 2. Walk Lever's `.application-question` blocks; the shared classifier
  //    handles the heterogeneous custom questions.
  const scope =
    root.querySelector('form[action*="lever.co"], form[action*="/apply"]') ?? root;
  for (const el of Array.from(scope.querySelectorAll<HTMLElement>('input, select, textarea'))) {
    if (seen.has(el)) continue;
    if (!isFillable(el)) continue;
    const ctx = collectContext(el);
    const classified = classifyByHeuristics(el, ctx);
    if (!classified) continue;
    out.push({ el, kind: classified.kind, label: ctx.label, confidence: classified.confidence });
  }

  return out;
}

async function fillResume(file: File, root: Document): Promise<boolean> {
  return attachResumeViaSlot(file, root, (d) => {
    // Lever uses name="resume" as the file input inside the drag-drop wrapper.
    const byName = d.querySelector<HTMLInputElement>('input[type="file"][name="resume"]');
    if (byName && !byName.disabled) return byName;
    return findResumeInput(d);
  });
}

/** Escape characters that would break a CSS attribute selector value. */
function cssAttrEscape(s: string): string {
  return s.replace(/(["\\])/g, '\\$1');
}
