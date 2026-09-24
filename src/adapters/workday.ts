import type { PlatformAdapter, DetectedField, FieldKind } from './types';
import {
  collectContext,
  classifyByHeuristics,
  isFillable,
  attachResumeViaSlot,
  findResumeInput,
  clipJobDescription,
  pickJobDescriptionByCss,
  hasSubmissionConfirmText,
  defaultDetectAll,
} from './_shared';

const AUTOMATION_ID_MAP: ReadonlyArray<{
  id: string;
  kind: FieldKind;
  confidence: number;
}> = [
  { id: 'firstName', kind: 'firstName', confidence: 0.99 },
  { id: 'lastName', kind: 'lastName', confidence: 0.99 },
  { id: 'preferredName', kind: 'preferredName', confidence: 0.95 },
  { id: 'email', kind: 'email', confidence: 0.99 },
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

  { id: 'jobTitle', kind: 'jobTitle', confidence: 0.99 },
  { id: 'companyName', kind: 'employer', confidence: 0.99 },
  { id: 'company', kind: 'employer', confidence: 0.95 },
  { id: 'currentlyWorkHere', kind: 'currentlyEmployed', confidence: 0.99 },
  { id: 'location', kind: 'employerLocation', confidence: 0.9 },
  { id: 'roleDescription', kind: 'roleDescription', confidence: 0.99 },
  { id: 'jobDescription', kind: 'roleDescription', confidence: 0.9 },

  { id: 'schoolName', kind: 'school', confidence: 0.99 },
  { id: 'school', kind: 'school', confidence: 0.95 },
  { id: 'degree', kind: 'degree', confidence: 0.99 },
  { id: 'fieldOfStudy', kind: 'fieldOfStudy', confidence: 0.99 },
  { id: 'gradeAverage', kind: 'gpa', confidence: 0.95 },
  { id: 'gpa', kind: 'gpa', confidence: 0.95 },
];

const DATE_CONTAINER_MAP: ReadonlyArray<{ id: string; kind: FieldKind }> = [
  { id: 'startDate', kind: 'startDate' },
  { id: 'fromDate', kind: 'startDate' },
  { id: 'endDate', kind: 'endDate' },
  { id: 'toDate', kind: 'endDate' },
];

const DATE_PART_IDS: ReadonlyArray<{ id: string; part: 'month' | 'year' }> = [
  { id: 'dateSectionMonth-input', part: 'month' },
  { id: 'dateSectionYear-input', part: 'year' },
];

function dateKindFromAutomationId(automationId: string): FieldKind | null {
  const lower = automationId.toLowerCase();
  for (const { id, kind } of DATE_CONTAINER_MAP) {
    if (lower === id.toLowerCase()) return kind;
  }
  for (const { id, kind } of DATE_CONTAINER_MAP) {
    if (lower.includes(id.toLowerCase())) return kind;
  }
  return null;
}

function collectDateFields(
  container: HTMLElement,
  kind: FieldKind,
  label: string,
): DetectedField[] {
  const out: DetectedField[] = [];
  for (const { id, part } of DATE_PART_IDS) {
    const input = container.querySelector<HTMLElement>(
      `[data-automation-id="${id}"]`,
    );
    if (!input || !isFillable(input)) continue;
    out.push({ el: input, kind, label, confidence: 0.95, datePart: part });
  }
  if (out.length > 0) return out;
  const single = container.matches('input, select, textarea')
    ? container
    : container.querySelector<HTMLElement>('input, select, textarea');
  if (single && isFillable(single)) {
    out.push({ el: single, kind, label, confidence: 0.85 });
  }
  return out;
}

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
    return !!doc.querySelector('[data-automation-id]');
  },
  detectFields,
  detectAll: (root) => defaultDetectAll({ detectFields }, root),
  fillResume,
  getJobDescription,
  detectSubmissionConfirmed,
};

function detectSubmissionConfirmed(doc: Document, _url: URL): boolean {
  if (
    doc.querySelector(
      '[data-automation-id="confirmationPage"], [data-automation-id="successPage"], [data-automation-id="confirmation"]',
    )
  ) {
    return true;
  }
  return hasSubmissionConfirmText(doc);
}

function detectFields(root: Document): DetectedField[] {
  const out: DetectedField[] = [];
  const seen = new WeakSet<HTMLElement>();

  const tagged = root.querySelectorAll<HTMLElement>('[data-automation-id]');
  for (const el of Array.from(tagged)) {
    const automationId = el.getAttribute('data-automation-id') ?? '';
    if (!automationId) continue;

    const dateKind = dateKindFromAutomationId(automationId);
    if (dateKind) {
      const ctx = collectContext(el);
      const parts = collectDateFields(el, dateKind, ctx.label || automationId);
      for (const part of parts) {
        if (seen.has(part.el)) continue;
        out.push(part);
        seen.add(part.el);
      }
      if (parts.length > 0) continue;
    }

    const classified = kindFromAutomationId(automationId);
    if (!classified) continue;

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
