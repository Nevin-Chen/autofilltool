import type {
  PlatformAdapter,
  DetectedField,
  DetectionResult,
  FieldKind,
  UnclassifiedField,
} from './types';
import { isSelfIdKind } from './types';
import {
  attachResumeViaSlot,
  classifyByHeuristics,
  clipJobDescription,
  collectContext,
  findResumeInput,
  findUnclassifiedFields,
  fromKeywords,
  hasSubmissionConfirmText,
  isFillable,
  normalize,
  pickJobDescriptionByCss,
  textOf,
} from './_shared';

const APPLICATION_FORM_SELECTOR = '.application-form form[name="form"]';

const MARKER_SELECTOR =
  'input#main-attachment[name="cResume"], form[ng-submit="apply()"], form[ng-controller="FormWithQuestionnaireCtrl"]';

const HONEYPOT_SELECTOR = '.apply-field-extra';

const HIDDEN_STEP_SELECTOR = '[data-section].ng-hide';

const QUESTION_SELECTOR = 'li.question';

const EEOC_SELECTOR = '[data-section="eeoc"], .eeoc-form-container';

const SALARY_WIDGET_SELECTOR = 'select.salary-details';

const CONSENT_CHECKBOX_SELECTOR = 'input[name="smsConsent"]';

const RESUME_SELECTOR = 'input[name="cResume"][type="file"]';

const CONFIRMATION_SELECTOR = '.application-confirmed';

const SUBMITTED_PATH_RE = /\/apply\/submitted\/?$/i;

const FIELD_MAP: ReadonlyArray<{ name: string; kind: FieldKind; confidence: number }> = [
  { name: 'cName', kind: 'fullName', confidence: 0.99 },
  { name: 'cEmail', kind: 'email', confidence: 0.99 },
  { name: 'cPhoneNumber', kind: 'phone', confidence: 0.99 },
  { name: 'cAddress', kind: 'cityAndRegion', confidence: 0.85 },
  { name: 'cSalary', kind: 'desiredSalary', confidence: 0.95 },
  { name: 'cCoverLetter', kind: 'coverLetter', confidence: 0.95 },
  { name: 'cSummary', kind: 'openEnded', confidence: 0.6 },
];

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

export const breezyAdapter: PlatformAdapter = {
  id: 'breezy',
  name: 'Breezy HR',
  matches: (url, doc) => {
    if (/(^|\.)breezy\.hr$/.test(url.hostname)) return true;
    return !!doc.querySelector(MARKER_SELECTOR);
  },
  detectFields,
  detectAll,
  fillResume,
  getJobDescription,
  detectSubmissionConfirmed,
};

function detectSubmissionConfirmed(doc: Document, url: URL): boolean {
  if (SUBMITTED_PATH_RE.test(url.pathname)) return true;
  const confirmed = doc.querySelector<HTMLElement>(CONFIRMATION_SELECTOR);
  if (confirmed && !confirmed.closest('.ng-hide')) return true;
  const formGone = !doc.querySelector(APPLICATION_FORM_SELECTOR);
  return formGone && hasSubmissionConfirmText(doc);
}

function getJobDescription(doc: Document): string {
  const byCss = pickJobDescriptionByCss(doc, [
    '#description .description',
    '.position-description .description',
    '.position-description',
  ]);
  if (byCss) return byCss;
  return clipJobDescription(jobHeader(doc));
}

function jobHeader(doc: Document): string {
  const parts: string[] = [];
  const title = doc.querySelector('.banner h1');
  if (title) {
    const text = textOf(title);
    if (text) parts.push(text);
  }
  for (const item of Array.from(doc.querySelectorAll('.banner .meta li'))) {
    const text = textOf(item);
    if (text) parts.push(text);
  }
  return parts.join('\n');
}

function detectFields(root: Document): DetectedField[] {
  const scope = root.querySelector<HTMLElement>(APPLICATION_FORM_SELECTOR) ?? root;
  const out: DetectedField[] = [];
  const seen = new WeakSet<HTMLElement>();

  for (const { name, kind, confidence } of FIELD_MAP) {
    const el = scope.querySelector<HTMLElement>(`[name="${name}"]`);
    if (!el || !isFillable(el) || isOutOfScope(el)) continue;
    out.push({ el, kind, label: labelFor(el), confidence });
    seen.add(el);
  }

  const seenGroups = new Set<string>();
  for (const el of Array.from(scope.querySelectorAll<HTMLElement>('input, select, textarea'))) {
    if (seen.has(el)) continue;
    if (!isFillable(el) || isOutOfScope(el)) continue;
    if (isChoiceInput(el)) {
      if (!el.name || seenGroups.has(el.name)) continue;
      seenGroups.add(el.name);
    }
    const label = labelFor(el);
    const hit = classify(el, label);
    if (!hit) continue;
    out.push({ el, kind: hit.kind, label, confidence: hit.confidence });
  }

  return out;
}

function detectAll(root: Document): DetectionResult {
  const classified = detectFields(root);
  const scope = root.querySelector<HTMLElement>(APPLICATION_FORM_SELECTOR);
  const claimed = new WeakSet<HTMLElement>(classified.map((f) => f.el));
  const claimedGroups = new Set(
    classified
      .filter((f) => isChoiceInput(f.el))
      .map((f) => f.el.getAttribute('name') ?? ''),
  );

  const unclassified: UnclassifiedField[] = findUnclassifiedFields(root, classified)
    .filter((u) => (!scope || scope.contains(u.el)) && !isOutOfScope(u.el))
    .filter((u) => !isQuestionChoice(u.el))
    .map((u) => ({ ...u, label: labelFor(u.el) || u.label }));

  for (const group of questionChoiceGroups(scope ?? root)) {
    if (claimed.has(group.rep) || claimedGroups.has(group.rep.name)) continue;
    unclassified.push({
      el: group.rep,
      label: group.question,
      fieldType: group.rep.type === 'checkbox' ? 'checkbox' : 'radio',
      options: group.options,
    });
  }

  return { classified, unclassified: sortByDomOrder(unclassified) };
}

function classify(
  el: HTMLElement,
  label: string,
): { kind: FieldKind; confidence: number } | null {
  const eeoc = eeocKind(el);
  if (eeoc) return eeoc;
  if (el.closest(QUESTION_SELECTOR)) return classifyQuestion(el, label);
  return classifyByHeuristics(el, collectContext(el));
}

function eeocKind(el: HTMLElement): { kind: FieldKind; confidence: number } | null {
  if (!el.closest(EEOC_SELECTOR)) return null;
  const name = el.getAttribute('name');
  if (!name) return null;
  const hit = fromKeywords(normalize(name));
  if (!hit || !isSelfIdKind(hit.kind)) return null;
  return { kind: hit.kind, confidence: 0.95 };
}

function classifyQuestion(
  el: HTMLElement,
  label: string,
): { kind: FieldKind; confidence: number } | null {
  if (el instanceof HTMLTextAreaElement) {
    if (/cover\s*letter/i.test(label)) return { kind: 'coverLetter', confidence: 0.85 };
    return { kind: 'openEnded', confidence: 0.6 };
  }
  const hit = fromKeywords(normalize(label));
  if (!hit || !QUESTION_KINDS.has(hit.kind)) return null;
  return hit;
}

function labelFor(el: HTMLElement): string {
  const item = el.closest<HTMLElement>(QUESTION_SELECTOR);
  if (item) {
    const heading = headingText(item.querySelector('h3'));
    if (heading) return heading;
  }
  const ctx = collectContext(el);
  if (isOwnLabel(el, ctx.label)) return headingAbove(el) || ctx.label;
  return ctx.label;
}

function isOwnLabel(el: HTMLElement, label: string): boolean {
  if (!label) return true;
  if (label === el.getAttribute('name')) return true;
  return isChoiceInput(el) && label === optionLabel(el);
}

function headingAbove(el: HTMLElement): string {
  const stop = el.closest(APPLICATION_FORM_SELECTOR) ?? el.ownerDocument.body;
  let node: Element | null = el;
  while (node && node !== stop) {
    for (let sib = node.previousElementSibling; sib; sib = sib.previousElementSibling) {
      if (sib.querySelector('input, select, textarea')) break;
      const heading = sib.matches('h2, h3') ? sib : sib.querySelector('h3, h2');
      if (heading) return headingText(heading);
    }
    node = node.parentElement;
  }
  return '';
}

function headingText(heading: Element | null): string {
  if (!heading) return '';
  return textOf(heading).replace(/\s*\*\s*$/, '').trim();
}

type QuestionChoiceGroup = {
  rep: HTMLInputElement;
  question: string;
  options: string[];
};

function questionChoiceGroups(scope: ParentNode): QuestionChoiceGroup[] {
  const out: QuestionChoiceGroup[] = [];
  for (const item of Array.from(scope.querySelectorAll<HTMLElement>(QUESTION_SELECTOR))) {
    const inputs = Array.from(
      item.querySelectorAll<HTMLInputElement>(
        'input[type="radio"], input[type="checkbox"]',
      ),
    ).filter((input) => isFillable(input) && !isOutOfScope(input));
    const rep = inputs[0];
    if (!rep) continue;
    const question = labelFor(rep);
    if (!question) continue;
    const options = inputs.map(optionLabel).filter((text) => text.length > 0);
    out.push({ rep, question, options });
  }
  return out;
}

function optionLabel(input: HTMLInputElement): string {
  const option = input.closest('li');
  if (option) {
    const text = textOf(option);
    if (text) return text;
  }
  return input.value.trim();
}

function isChoiceInput(el: HTMLElement): el is HTMLInputElement {
  return el instanceof HTMLInputElement && (el.type === 'radio' || el.type === 'checkbox');
}

function isQuestionChoice(el: HTMLElement): boolean {
  return isChoiceInput(el) && !!el.closest(QUESTION_SELECTOR);
}

function isOutOfScope(el: HTMLElement): boolean {
  if (el.closest(HONEYPOT_SELECTOR)) return true;
  if (el.closest(HIDDEN_STEP_SELECTOR)) return true;
  if (el.matches(CONSENT_CHECKBOX_SELECTOR)) return true;
  if (el.matches(SALARY_WIDGET_SELECTOR)) return true;
  return false;
}

function sortByDomOrder(fields: UnclassifiedField[]): UnclassifiedField[] {
  return fields.slice().sort((a, b) => {
    const rel = a.el.compareDocumentPosition(b.el);
    if (rel & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    if (rel & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    return 0;
  });
}

async function fillResume(file: File, root: Document): Promise<boolean> {
  return attachResumeViaSlot(file, root, pickResumeSlot);
}

function pickResumeSlot(doc: Document): HTMLInputElement | null {
  const input = doc.querySelector(RESUME_SELECTOR);
  if (input instanceof HTMLInputElement && !input.disabled) return input;
  return findResumeInput(doc);
}
