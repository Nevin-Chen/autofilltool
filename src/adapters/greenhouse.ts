/**
 * Greenhouse adapter. Greenhouse application forms come in two flavours:
 *
 *   - **Legacy** (`boards.greenhouse.io/<company>/jobs/<id>`): vanilla
 *     server-rendered form with stable ids — `#first_name`, `#last_name`,
 *     `#email`, `#phone`, `#resume`, wrapped in `<form id="application-form">`.
 *
 *   - **New redesign** (`job-boards.greenhouse.io/<company>/jobs/<id>`,
 *     also served inside iframes embedded on company career pages as
 *     `<iframe id="grnhse_iframe" src="https://job-boards.greenhouse.io/embed/...">`):
 *     Next.js SPA with React-controlled inputs. The stable signals are
 *     `name` attributes (`first_name`, `last_name`, `email`, `phone`) and
 *     label text. The form root id is gone; the file input is wrapped in a
 *     custom uploader widget with a hidden `<input type="file" accept=".pdf,...">`.
 *
 * Strategy: try every angle. Known names first (works on both layouts),
 * then known ids (legacy only), then walk every fillable input in the doc
 * and classify by label/heuristics. Resume slot uses name → id → accept
 * hint → shared finder.
 *
 * Custom domains (e.g. `careers.foo.com` CNAMing to a Greenhouse host) are
 * matched via DOM markers: the wrapping `<div id="grnhse_app">` from the
 * embed script and either `form#application-form` (legacy) or the
 * `<iframe id="grnhse_iframe">` that the embed JS inserts.
 */

import type { PlatformAdapter, DetectedField, FieldKind } from './types';
import {
  classifyByHeuristics,
  collectContext,
  isFillable,
  attachResumeViaSlot,
  findResumeInput,
} from './_shared';

/**
 * Greenhouse's stable input identifiers. The new redesign keeps the
 * `name` attribute but drops/renames `id`, so we check both — first by
 * `name=` (works on both layouts), then by `id` (legacy only).
 */
const KNOWN_FIELDS: ReadonlyArray<{ field: string; kind: FieldKind; confidence: number }> = [
  { field: 'first_name', kind: 'firstName', confidence: 0.99 },
  { field: 'last_name', kind: 'lastName', confidence: 0.99 },
  { field: 'email', kind: 'email', confidence: 0.99 },
  { field: 'phone', kind: 'phone', confidence: 0.99 },
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
    // 1) URL signal — covers both legacy + new-redesign hosts and any
    //    *.greenhouse.io subdomain (including iframe sources).
    if (/(^|\.)greenhouse\.io$/.test(url.hostname)) return true;
    // 2) DOM markers — used when a custom domain or a parent page CNAMEs
    //    to Greenhouse, or when the adapter happens to run on the parent
    //    page of an embed (so we still beat generic):
    //      - `form#application-form` (legacy embed; some older layouts)
    //      - `#grnhse_app`           (the wrapper div the embed JS creates)
    //      - `#grnhse_iframe`        (the iframe id the embed JS creates)
    return !!(
      doc.querySelector('form#application-form') ||
      doc.getElementById('grnhse_app') ||
      doc.getElementById('grnhse_iframe')
    );
  },
  detectFields,
  fillResume,
};

function detectFields(root: Document): DetectedField[] {
  const out: DetectedField[] = [];
  const seen = new WeakSet<HTMLElement>();

  // 1) Known canonical fields — try `name=` first (works on both layouts),
  //    then `id=` (legacy only). Highest confidence either way.
  for (const { field, kind, confidence } of KNOWN_FIELDS) {
    let el: HTMLElement | null = root.querySelector<HTMLElement>(
      `input[name="${field}"], select[name="${field}"], textarea[name="${field}"]`,
    );
    if (!el) {
      const byId = root.getElementById(field);
      if (byId instanceof HTMLElement) el = byId;
    }
    if (el && isFillable(el) && !seen.has(el)) {
      const label = textForLabel(root, el.id) || textOfNearbyLabel(el) || field;
      out.push({ el, kind, label, confidence });
      seen.add(el);
    }
  }

  // 2) Walk every fillable input in the document and classify it. The
  //    legacy layout was scoped to `form#application-form`, but the new
  //    redesign drops that id — scope = whole doc works for both because
  //    `isFillable` already excludes hidden/submit/file inputs.
  for (const el of Array.from(
    root.querySelectorAll<HTMLElement>('input, select, textarea'),
  )) {
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
  // Legacy: `<input id="resume" type="file">`.
  // New redesign: hidden `<input type="file" name="resume" accept=".pdf,...">`
  //   wrapped in a custom uploader widget that exposes an "Attach" button.
  return attachResumeViaSlot(file, root, (d) => {
    // 1) name-based — works for both layouts; covers `resume`, `resumeFile`,
    //    `cv`, etc.
    const byName = d.querySelector<HTMLInputElement>(
      'input[type="file"][name*="resume" i], input[type="file"][name*="cv" i]',
    );
    if (byName && !byName.disabled) return byName;
    // 2) Legacy id.
    const byId = d.getElementById('resume');
    if (byId instanceof HTMLInputElement && byId.type === 'file' && !byId.disabled) {
      return byId;
    }
    // 3) Fall back to the shared finder — uses RESUME_HINTS over the label
    //    + accept attribute, so it picks up the new-redesign hidden input
    //    via `accept=".pdf,.doc,.docx,.txt,.rtf"`.
    return findResumeInput(d);
  });
}

function textForLabel(root: Document, forId: string): string {
  if (!forId) return '';
  const lbl = root.querySelector<HTMLLabelElement>(`label[for="${forId}"]`);
  return (lbl?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Walk up looking for a wrapping or sibling label-shaped element. Used
 * when the input has no `id` (so `label[for]` can't find it) — common in
 * the new React-rendered redesign.
 */
function textOfNearbyLabel(el: HTMLElement): string {
  const wrapping = el.closest('label');
  if (wrapping) {
    const t = (wrapping.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (t) return t;
  }
  let cursor: HTMLElement | null = el.parentElement;
  for (let depth = 0; cursor && depth < 3; depth++, cursor = cursor.parentElement) {
    const candidate = cursor.querySelector('label');
    if (candidate) {
      const t = (candidate.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (t) return t;
    }
  }
  return '';
}
