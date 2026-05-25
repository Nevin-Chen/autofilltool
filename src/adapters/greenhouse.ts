/**
 * Greenhouse adapter. Greenhouse-hosted application forms have very stable
 * ids on the canonical fields and put custom questions in `.field` blocks
 * inside `form#application-form`.
 *
 * Coverage:
 *   - `boards.greenhouse.io/<company>/jobs/<id>`
 *   - `job-boards.greenhouse.io/<company>/jobs/<id>` (newer redesign)
 *   - `*.greenhouse.io` (custom domains, e.g., careers.foo.com → CNAME)
 *
 * Strategy: use the known ids for the standard fields (firstName, lastName,
 * email, phone, links), then fall through to the shared heuristic classifier
 * for custom questions. Resume slot is the dedicated `#resume` input.
 */

import type { PlatformAdapter, DetectedField, FieldKind } from './types';
import {
  classifyByHeuristics,
  collectContext,
  isFillable,
  attachResumeViaSlot,
  findResumeInput,
} from './_shared';

/** Greenhouse's stable input id → FieldKind mapping. */
const KNOWN_IDS: ReadonlyArray<{ id: string; kind: FieldKind; confidence: number }> = [
  { id: 'first_name', kind: 'firstName', confidence: 0.99 },
  { id: 'last_name', kind: 'lastName', confidence: 0.99 },
  { id: 'email', kind: 'email', confidence: 0.99 },
  { id: 'phone', kind: 'phone', confidence: 0.99 },
];

/** Common custom-question label substrings → FieldKind. */
const LABEL_HINTS: ReadonlyArray<{ re: RegExp; kind: FieldKind; confidence: number }> = [
  { re: /linkedin/i, kind: 'linkedin', confidence: 0.95 },
  { re: /github/i, kind: 'github', confidence: 0.95 },
  { re: /(portfolio|personal website)/i, kind: 'portfolio', confidence: 0.85 },
  { re: /current company/i, kind: 'otherLink', confidence: 0.4 }, // low; user can ignore
];

export const greenhouseAdapter: PlatformAdapter = {
  id: 'greenhouse',
  name: 'Greenhouse',
  matches: (url, doc) => {
    if (/(^|\.)greenhouse\.io$/.test(url.hostname)) return true;
    // Custom domains: Greenhouse-embedded forms always include this form.
    return !!doc.querySelector('form#application-form');
  },
  detectFields,
  fillResume,
};

function detectFields(root: Document): DetectedField[] {
  const out: DetectedField[] = [];
  const seen = new WeakSet<HTMLElement>();

  // 1. Known canonical fields first (highest confidence).
  for (const { id, kind, confidence } of KNOWN_IDS) {
    const el = root.getElementById(id);
    if (el instanceof HTMLElement && isFillable(el)) {
      const label = textForLabel(root, id) || id;
      out.push({ el, kind, label, confidence });
      seen.add(el);
    }
  }

  // 2. Walk the application form (or document) for everything else; prefer
  //    label-based classification before falling back to heuristics.
  const scope = root.querySelector<HTMLFormElement>('form#application-form') ?? root;
  for (const el of Array.from(scope.querySelectorAll<HTMLElement>('input, select, textarea'))) {
    if (seen.has(el)) continue;
    if (!isFillable(el)) continue;

    const ctx = collectContext(el);
    const hinted = LABEL_HINTS.find((h) => h.re.test(ctx.label) || h.re.test(ctx.haystack));
    if (hinted) {
      out.push({ el, kind: hinted.kind, label: ctx.label, confidence: hinted.confidence });
      continue;
    }
    const classified = classifyByHeuristics(el, ctx);
    if (!classified) continue;
    out.push({ el, kind: classified.kind, label: ctx.label, confidence: classified.confidence });
  }

  return out;
}

async function fillResume(file: File, root: Document): Promise<boolean> {
  // Greenhouse's classic form has #resume; the newer job-boards redesign uses
  // an input near the "Resume / CV" label. Try the canonical id first, then
  // fall back to the shared finder.
  return attachResumeViaSlot(file, root, (d) => {
    const byId = d.getElementById('resume');
    if (byId instanceof HTMLInputElement && byId.type === 'file' && !byId.disabled) {
      return byId;
    }
    // Newer redesign — name="resume" or wrapped in a .resume label.
    const byName = d.querySelector<HTMLInputElement>('input[type="file"][name*="resume" i]');
    if (byName && !byName.disabled) return byName;
    return findResumeInput(d);
  });
}

function textForLabel(root: Document, forId: string): string {
  const lbl = root.querySelector<HTMLLabelElement>(`label[for="${forId}"]`);
  return (lbl?.textContent ?? '').replace(/\s+/g, ' ').trim();
}
