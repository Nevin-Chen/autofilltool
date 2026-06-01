/**
 * Workday adapter — a multi-step React wizard at `<company>.myworkdayjobs.com`
 * (often iframed on career pages). Key conventions:
 *  - **Selectors**: every element carries a stable `data-automation-id`; CSS
 *    classes are re-hashed per build, so this is the only reliable signal.
 *  - **Native vs virtualised**: text inputs are native; dropdowns are
 *    `button[role=combobox]` triggers opening a portal listbox, marked
 *    `virtualizedDropdown` so runFill uses the async filler.
 *  - **Multi-step**: each phase is a separate page; we don't auto-advance —
 *    the user clicks Next and re-clicks Fill. detectFields is stateless.
 *  - **Resume**: hidden `input[type=file][data-automation-id=
 *    file-upload-input-ref]`, filled via the shared DataTransfer trick.
 */

import type { PlatformAdapter, DetectedField, FieldKind } from './types';
import {
  collectContext,
  classifyByHeuristics,
  isFillable,
  attachResumeViaSlot,
  findResumeInput,
  clipJobDescription,
  pickJobDescriptionByCss,
} from './_shared';

/** Workday automation ids → FieldKind. Order matters (exact before substring). */
const AUTOMATION_ID_MAP: ReadonlyArray<{
  id: string;
  kind: FieldKind;
  confidence: number;
}> = [
  { id: 'firstName', kind: 'firstName', confidence: 0.99 },
  { id: 'lastName', kind: 'lastName', confidence: 0.99 },
  { id: 'preferredName', kind: 'preferredName', confidence: 0.95 },
  { id: 'email', kind: 'email', confidence: 0.99 },
  // Phone varies (phone-input, phoneNumber, mobilePhone); substring match folds them to 'phone'.
  { id: 'phone', kind: 'phone', confidence: 0.95 },
  { id: 'mobile', kind: 'phone', confidence: 0.85 },
  { id: 'addressLine1', kind: 'addressLine1', confidence: 0.99 },
  { id: 'addressLine2', kind: 'addressLine2', confidence: 0.95 },
  { id: 'city', kind: 'city', confidence: 0.95 },
  { id: 'region', kind: 'region', confidence: 0.9 },
  { id: 'state', kind: 'region', confidence: 0.9 },
  { id: 'province', kind: 'region', confidence: 0.9 },
  { id: 'postalCode', kind: 'postalCode', confidence: 0.99 },
  { id: 'zipCode', kind: 'postalCode', confidence: 0.95 },
  { id: 'countryDropdown', kind: 'country', confidence: 0.99 },
  { id: 'country', kind: 'country', confidence: 0.95 },
];

/** Exact match first, then case-insensitive substring (catches `phoneNumber--input` etc). */
function kindFromAutomationId(
  automationId: string,
): { kind: FieldKind; confidence: number } | null {
  const lower = automationId.toLowerCase();
  for (const { id, kind, confidence } of AUTOMATION_ID_MAP) {
    if (lower === id.toLowerCase()) return { kind, confidence };
  }
  for (const { id, kind, confidence } of AUTOMATION_ID_MAP) {
    if (lower.includes(id.toLowerCase())) {
      return { kind, confidence: Math.max(0.7, confidence - 0.1) }; // substring → lower confidence
    }
  }
  return null;
}

/** True iff the element is a Workday virtualised-dropdown trigger. */
function isVirtualizedDropdownTrigger(el: HTMLElement): boolean {
  return (
    el.getAttribute('role') === 'combobox' ||
    el.getAttribute('aria-haspopup') === 'listbox'
  );
}

export const workdayAdapter: PlatformAdapter = {
  id: 'workday',
  name: 'Workday',
  matches: (url, doc) => {
    if (/(^|\.)myworkdayjobs\.com$/.test(url.hostname)) return true;
    // DOM marker for CNAMEd iframes whose hostname doesn't match.
    return !!doc.querySelector('[data-automation-id]');
  },
  detectFields,
  fillResume,
  getJobDescription,
};

function detectFields(root: Document): DetectedField[] {
  const out: DetectedField[] = [];
  const seen = new WeakSet<HTMLElement>();

  // 1) Classify every `data-automation-id` element by id — both real inputs
  //    and dropdown triggers; the `widget` marker distinguishes them later.
  const tagged = root.querySelectorAll<HTMLElement>('[data-automation-id]');
  for (const el of Array.from(tagged)) {
    const automationId = el.getAttribute('data-automation-id') ?? '';
    if (!automationId) continue;
    const classified = kindFromAutomationId(automationId);
    if (!classified) continue;

    // Dropdown triggers aren't fillable inputs but the async filler handles
    // them; everything else must pass the standard fillable check.
    const isCombo = isVirtualizedDropdownTrigger(el);
    if (!isCombo && !isFillable(el)) continue;
    if (seen.has(el)) continue;

    const ctx = collectContext(el);
    const label = ctx.label || automationId;
    out.push({
      el,
      kind: classified.kind,
      label,
      confidence: classified.confidence,
      ...(isCombo ? { widget: 'virtualizedDropdown' as const } : {}),
    });
    seen.add(el);
  }

  // 2) Heuristics for untagged inputs (defensive; also catches open-ended
  //    textareas in the "Application Questions" step).
  for (const el of Array.from(
    root.querySelectorAll<HTMLElement>('input, select, textarea'),
  )) {
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
    // Distinctive automation id, then any file input with one (older tenants
    // use `attachments-input-ref` etc.), then the generic finder.
    const byAutomation = d.querySelector<HTMLInputElement>(
      'input[type="file"][data-automation-id="file-upload-input-ref"]',
    );
    if (byAutomation && !byAutomation.disabled) return byAutomation;
    const byAnyAutomation = d.querySelector<HTMLInputElement>(
      'input[type="file"][data-automation-id]',
    );
    if (byAnyAutomation && !byAnyAutomation.disabled) return byAnyAutomation;
    return findResumeInput(d);
  });
}

/** JD lives in `[data-automation-id=jobPostingDescription]`; falls back to main, then body. */
function getJobDescription(doc: Document): string {
  const byCss = pickJobDescriptionByCss(doc, [
    '[data-automation-id="jobPostingDescription"]',
    '[data-automation-id="jobPostingContent"]',
    'main',
  ]);
  if (byCss) return byCss;
  if (doc.body) return clipJobDescription(doc.body.textContent ?? '');
  return '';
}
