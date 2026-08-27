import type {
  PlatformAdapter,
  DetectedField,
  DetectionResult,
  FieldKind,
  UnclassifiedField,
} from './types';
import {
  bestLabel,
  classifyByHeuristics,
  clipJobDescription,
  collectContext,
  findResumeInput,
  findUnclassifiedFields,
  fromKeywords,
  isFillable,
  attachResumeViaSlot,
  normalize,
  textOf,
  hasSubmissionConfirmText,
} from './_shared';

const APPLICATION_FORM_SELECTOR = 'form[data-ui="application-form"]';

const RADIO_GROUP_SELECTOR = 'fieldset[role="radiogroup"], [role="radiogroup"]';

const PHONE_WIDGET_SELECTOR = '[data-ui="phone"]';

const FIELD_MAP: ReadonlyArray<{
  name: string;
  kind: FieldKind;
  confidence: number;
  label?: string;
}> = [
  { name: 'firstname', kind: 'firstName', confidence: 0.99 },
  { name: 'lastname', kind: 'lastName', confidence: 0.99 },
  { name: 'email', kind: 'email', confidence: 0.99 },
  { name: 'phone', kind: 'phone', confidence: 0.99, label: 'Phone' },
  { name: 'address', kind: 'cityAndRegion', confidence: 0.85 },
  { name: 'cover_letter', kind: 'coverLetter', confidence: 0.95 },
];

const ADDRESS_MIRROR_NAMES: ReadonlySet<string> = new Set([
  'city',
  'postcode',
  'country',
]);

const CUSTOM_QUESTION_NAME = /^(QA|CA)_\d+$/;

const QUESTION_KINDS: ReadonlySet<FieldKind> = new Set<FieldKind>([
  'authorizedToWorkInUS',
  'requiresSponsorship',
  'willingToRelocate',
  'desiredSalary',
  'gender',
  'pronouns',
  'ethnicity',
  'race',
  'veteranStatus',
  'disabilityStatus',
  'linkedin',
  'github',
  'portfolio',
  'twitter',
  'school',
  'degree',
  'fieldOfStudy',
  'gradYear',
]);

const RESUME_SELECTOR = '[data-ui="resume"]';

export const workableAdapter: PlatformAdapter = {
  id: 'workable',
  name: 'Workable',
  matches: (url, doc) => {
    if (/(^|\.)workable\.com$/.test(url.hostname)) return true;
    return !!doc.querySelector(APPLICATION_FORM_SELECTOR);
  },
  detectFields,
  detectAll,
  fillResume,
  getJobDescription,
  detectSubmissionConfirmed,
};

function detectSubmissionConfirmed(doc: Document, _url: URL): boolean {
  if (doc.querySelector(APPLICATION_FORM_SELECTOR)) return false;
  const eeoc = '[data-ui="eeoc-form"], [data-ui="skip-eeoc"], [data-ui="submit-eeoc"]';
  if (doc.querySelector(eeoc)) return true;
  return hasSubmissionConfirmText(doc);
}

function getJobDescription(doc: Document): string {
  const body = ['job-description', 'job-requirements', 'job-benefits']
    .map((ui) => (doc.querySelector(`[data-ui="${ui}"]`)?.textContent ?? '').trim())
    .filter((s) => s.length > 0);
  if (body.length > 0) return clipJobDescription(body.join('\n\n'));

  return clipJobDescription(jobHeader(doc));
}

function jobHeader(doc: Document): string {
  const parts: string[] = [];
  for (const ui of ['job-title', 'job-department', 'job-location', 'job-workplace']) {
    const el = doc.querySelector(`[data-ui="${ui}"]`);
    if (!el) continue;
    const text = textOf(el);
    if (text) parts.push(text);
  }
  return parts.join('\n');
}

function detectFields(root: Document): DetectedField[] {
  const scope = root.querySelector<HTMLElement>(APPLICATION_FORM_SELECTOR) ?? root;
  const out: DetectedField[] = [];
  const seen = new WeakSet<HTMLElement>();

  for (const { name, kind, confidence, label } of FIELD_MAP) {
    const el = scope.querySelector<HTMLElement>(`[name="${name}"]`);
    if (!el || !isFillable(el)) continue;
    const ctx = collectContext(el);
    out.push({ el, kind, label: label ?? (ctx.label || name), confidence });
    seen.add(el);
  }

  for (const group of choiceGroups(scope)) {
    for (const input of group.inputs) seen.add(input);
    const hit = classifyQuestion(group.question);
    if (!hit) continue;
    out.push({
      el: group.rep,
      kind: hit.kind,
      label: group.question,
      confidence: hit.confidence,
    });
  }

  for (const el of Array.from(scope.querySelectorAll<HTMLElement>('input, select, textarea'))) {
    if (seen.has(el)) continue;
    if (!isFillable(el)) continue;
    if (isAddressMirror(el) || isPhoneWidgetChrome(el)) continue;

    const ctx = collectContext(el);
    const hit = isCustomQuestion(el)
      ? classifyQuestion(ctx.label, el)
      : classifyByHeuristics(el, ctx);
    if (!hit) continue;
    out.push({ el, kind: hit.kind, label: ctx.label, confidence: hit.confidence });
  }

  return out;
}

function detectAll(root: Document): DetectionResult {
  const classified = detectFields(root);
  const scope = root.querySelector<HTMLElement>(APPLICATION_FORM_SELECTOR) ?? root;
  const claimed = new WeakSet<HTMLElement>(classified.map((f) => f.el));

  const unclassified: UnclassifiedField[] = findUnclassifiedFields(root, classified).filter(
    (u) =>
      scope.contains(u.el) && !isAddressMirror(u.el) && !isPhoneWidgetChrome(u.el),
  );

  for (const group of choiceGroups(scope)) {
    if (claimed.has(group.rep)) continue;
    unclassified.push({
      el: group.rep,
      label: group.question,
      fieldType: 'radio',
      options: group.options,
    });
  }

  return { classified, unclassified: sortByDomOrder(unclassified) };
}

function sortByDomOrder(fields: UnclassifiedField[]): UnclassifiedField[] {
  return fields.slice().sort((a, b) => {
    const rel = a.el.compareDocumentPosition(b.el);
    if (rel & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    if (rel & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    return 0;
  });
}

type ChoiceGroup = {
  rep: HTMLInputElement;
  inputs: HTMLInputElement[];
  question: string;
  options: string[];
};

function choiceGroups(scope: ParentNode): ChoiceGroup[] {
  const out: ChoiceGroup[] = [];
  for (const container of Array.from(
    scope.querySelectorAll<HTMLElement>(RADIO_GROUP_SELECTOR),
  )) {
    const inputs = Array.from(
      container.querySelectorAll<HTMLInputElement>('input[type="radio"]'),
    ).filter((r) => !r.disabled);
    const rep = inputs[0];
    if (!rep) continue;
    const question = collectContext(rep).label || bestLabel(container);
    if (!question) continue;
    const options = inputs.map((r) => bestLabel(r).trim()).filter((s) => s.length > 0);
    out.push({ rep, inputs, question, options });
  }
  return out;
}

function classifyQuestion(
  label: string,
  el?: HTMLElement,
): { kind: FieldKind; confidence: number } | null {
  if (el instanceof HTMLTextAreaElement) {
    if (/cover\s*letter/i.test(label)) return { kind: 'coverLetter', confidence: 0.85 };
    return { kind: 'openEnded', confidence: 0.6 };
  }
  const hit = fromKeywords(normalize(label));
  if (!hit || !QUESTION_KINDS.has(hit.kind)) return null;
  return hit;
}

function isCustomQuestion(el: HTMLElement): boolean {
  return CUSTOM_QUESTION_NAME.test(el.getAttribute('name') ?? '');
}

function isAddressMirror(el: HTMLElement): boolean {
  return ADDRESS_MIRROR_NAMES.has(el.getAttribute('name') ?? '');
}

function isPhoneWidgetChrome(el: HTMLElement): boolean {
  if (el.getAttribute('name') === 'phone') return false;
  return !!el.closest(PHONE_WIDGET_SELECTOR);
}

async function fillResume(file: File, root: Document): Promise<boolean> {
  return attachResumeViaSlot(file, root, pickResumeSlot);
}

function pickResumeSlot(doc: Document): HTMLInputElement | null {
  const input = doc.querySelector(RESUME_SELECTOR);
  if (input instanceof HTMLInputElement && input.type === 'file' && !input.disabled) {
    return input;
  }
  return findResumeInput(doc);
}
