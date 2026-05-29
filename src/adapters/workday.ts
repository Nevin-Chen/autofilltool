/**
 * Workday adapter. Workday's apply flow is a multi-step React wizard
 * hosted at `<company>.myworkdayjobs.com` (often also embedded as an
 * iframe on the company's career page).
 *
 * Coverage and conventions:
 *
 *  - **URL match**: `*.myworkdayjobs.com`. The frame-targeting helper in
 *    `src/background/frames.ts` already routes Workday iframes here.
 *  - **Selectors**: every interactive element carries a stable
 *    `data-automation-id` attribute (Workday's own QA hooks). React
 *    re-hashes CSS class names per build, so `data-automation-id` is the
 *    one reliable signal.
 *  - **Native vs virtualised**: text inputs are native `<input>`.
 *    Dropdowns (country, state, etc.) are `<button role="combobox">`
 *    triggers that open a portal-mounted listbox when clicked; handled
 *    via the `virtualizedDropdown` widget marker, which routes runFill
 *    through the async `fillVirtualizedDropdown` helper instead of the
 *    sync filler.
 *  - **Multi-step wizard**: each Workday phase ("My Information", "My
 *    Experience", "Application Questions", etc.) is a separate page.
 *    We don't auto-advance — the user clicks Next themselves and then
 *    re-clicks Fill on the next page. The adapter is intentionally
 *    stateless: detectFields just walks the current page.
 *  - **Resume upload**: there's a visible "Select files" button next to
 *    a hidden `<input type="file" data-automation-id="file-upload-input-ref">`.
 *    The shared `attachFile` helper sets `.files` directly on that
 *    hidden input via DataTransfer — same trick the other adapters use.
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

/**
 * Map Workday's stable automation ids to our FieldKind enum. Order
 * matters when an automation id is a substring of another — checked
 * before the loose contains-match below.
 */
const AUTOMATION_ID_MAP: ReadonlyArray<{
  id: string;
  kind: FieldKind;
  confidence: number;
}> = [
  { id: 'firstName', kind: 'firstName', confidence: 0.99 },
  { id: 'lastName', kind: 'lastName', confidence: 0.99 },
  { id: 'preferredName', kind: 'preferredName', confidence: 0.95 },
  { id: 'email', kind: 'email', confidence: 0.99 },
  // Phone numbers vary: `phone-input`, `phoneNumber`, `mobilePhone`. We
  // match the prefix in `kindFromAutomationId` so all of those land in
  // 'phone'.
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

/**
 * Substring match: maps any automation id that *contains* the key (case
 * insensitive) to the kind. Lower priority than the exact list above.
 * Used to catch variants like `phoneNumber--input`.
 */
function kindFromAutomationId(
  automationId: string,
): { kind: FieldKind; confidence: number } | null {
  const lower = automationId.toLowerCase();
  for (const { id, kind, confidence } of AUTOMATION_ID_MAP) {
    if (lower === id.toLowerCase()) return { kind, confidence };
  }
  for (const { id, kind, confidence } of AUTOMATION_ID_MAP) {
    if (lower.includes(id.toLowerCase())) {
      // Knock confidence down a hair for substring matches.
      return { kind, confidence: Math.max(0.7, confidence - 0.1) };
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
    // DOM markers — let us win over generic on a company iframe whose
    // hostname doesn't match but whose content is clearly Workday.
    return !!doc.querySelector('[data-automation-id]');
  },
  detectFields,
  fillResume,
  getJobDescription,
};

function detectFields(root: Document): DetectedField[] {
  const out: DetectedField[] = [];
  const seen = new WeakSet<HTMLElement>();

  // 1) Walk every element with a `data-automation-id` and classify by id.
  //    Both real inputs and virtualised-dropdown triggers are matched
  //    here; the `widget` marker distinguishes them downstream.
  const tagged = root.querySelectorAll<HTMLElement>('[data-automation-id]');
  for (const el of Array.from(tagged)) {
    const automationId = el.getAttribute('data-automation-id') ?? '';
    if (!automationId) continue;
    const classified = kindFromAutomationId(automationId);
    if (!classified) continue;

    // Virtualised dropdown? The trigger itself isn't a fillable input,
    // but the async filler handles it. Otherwise require the element
    // pass the standard fillable check.
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

  // 2) Fall back to heuristic classification for inputs Workday didn't
  //    tag (rare on real Workday pages, but defensive — also catches
  //    open-ended textareas in the "Application Questions" step).
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
    // Workday's hidden file input has a very distinctive automation id.
    const byAutomation = d.querySelector<HTMLInputElement>(
      'input[type="file"][data-automation-id="file-upload-input-ref"]',
    );
    if (byAutomation && !byAutomation.disabled) return byAutomation;
    // Some older Workday tenants use `attachments-input-ref` etc. Any
    // `data-automation-id` attribute on a file input is a strong signal.
    const byAnyAutomation = d.querySelector<HTMLInputElement>(
      'input[type="file"][data-automation-id]',
    );
    if (byAnyAutomation && !byAnyAutomation.disabled) return byAnyAutomation;
    // Last resort.
    return findResumeInput(d);
  });
}

/**
 * Workday job posting pages put the body text in
 * `[data-automation-id="jobPostingDescription"]`. The apply flow's
 * "About this role" sidebar uses the same automation id. Falls back to
 * `main` then body text.
 */
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
