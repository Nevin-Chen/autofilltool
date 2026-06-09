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
];

function kindFromAutomationId(
  automationId: string,
): { kind: FieldKind; confidence: number } | null {
  const lower = automationId.toLowerCase();
  for (const { id, kind, confidence } of AUTOMATION_ID_MAP) {
    if (lower === id.toLowerCase()) return { kind, confidence };
  }
  for (const { id, kind, confidence } of AUTOMATION_ID_MAP) {
    if (lower.includes(id.toLowerCase())) {
      return { kind, confidence: Math.max(0.7, confidence - 0.1) };
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
