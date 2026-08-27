import type {
  PlatformAdapter,
  DetectedField,
  DetectionResult,
  FieldKind,
  UnclassifiedField,
} from './types';
import {
  classifyByHeuristics,
  collectContext,
  findResumeInput,
  findUnclassifiedFields,
  fromKeywords,
  isFillable,
  attachResumeViaSlot,
  clipJobDescription,
  normalize,
  pickJobDescriptionByCss,
  hasSubmissionConfirmText,
} from './_shared';

const APPLICATION_FORM_SELECTOR =
  'form[data-test^="form_submit_"], form[id^="form_submit_"]';

const NAME_MAP: ReadonlyArray<{ name: string; kind: FieldKind; confidence: number }> = [
  { name: 'resumator-firstname-value', kind: 'firstName', confidence: 0.99 },
  { name: 'resumator-lastname-value', kind: 'lastName', confidence: 0.99 },
  { name: 'resumator-email-value', kind: 'email', confidence: 0.99 },
  { name: 'resumator-phone-value', kind: 'phone', confidence: 0.99 },
  { name: 'resumator-address-value', kind: 'addressLine1', confidence: 0.95 },
  { name: 'resumator-city-value', kind: 'city', confidence: 0.99 },
  { name: 'resumator-state-value', kind: 'region', confidence: 0.99 },
  { name: 'resumator-postal-value', kind: 'postalCode', confidence: 0.99 },
  { name: 'resumator-country-value', kind: 'country', confidence: 0.99 },
  { name: 'resumator-linkedin-value', kind: 'linkedin', confidence: 0.99 },
  { name: 'resumator-coverletter-value', kind: 'coverLetter', confidence: 0.95 },
];

const RESERVED_NAMES: ReadonlySet<string> = new Set([
  'resumator-resumetext-value',
  'resumator-xml-value',
]);

const QUESTIONNAIRE_KINDS: ReadonlySet<FieldKind> = new Set<FieldKind>([
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

const NO_SELECTION_VALUE = 'resumator_no_selection';

const RESUME_FILE_ID = 'resumator-resume-value';
const RESUME_TEXT_ID = 'resumator-resumetext-value';
const RESUME_UPLOAD_TOGGLE_ID = 'resumator-choose-upload';

export const jazzhrAdapter: PlatformAdapter = {
  id: 'jazzhr',
  name: 'JazzHR',
  matches: (url, doc) => {
    if (/(^|\.)applytojob\.com$/.test(url.hostname)) return true;
    return !!doc.querySelector(
      'form[data-test="form_submit_new_resume"], #resumator-submit-resume, input[name^="resumator-"]',
    );
  },
  detectFields,
  detectAll,
  fillResume,
  getJobDescription,
  detectSubmissionConfirmed,
};

function detectSubmissionConfirmed(doc: Document, _url: URL): boolean {
  const formGone = !doc.querySelector(APPLICATION_FORM_SELECTOR);
  return formGone && hasSubmissionConfirmText(doc);
}

function getJobDescription(doc: Document): string {
  const byCss = pickJobDescriptionByCss(doc, [
    '#job-description',
    '.page-body.job-details .description',
    '.page-body.job-details',
    'main',
  ]);
  if (byCss) return byCss;
  if (doc.body) return clipJobDescription(doc.body.textContent ?? '');
  return '';
}

function detectFields(root: Document): DetectedField[] {
  const out: DetectedField[] = [];
  const seen = new WeakSet<HTMLElement>();

  for (const { name, kind, confidence } of NAME_MAP) {
    const el = root.querySelector<HTMLElement>(`[name="${name}"]`);
    if (!el || !isFillable(el)) continue;
    const ctx = collectContext(el);
    out.push({ el, kind, label: ctx.label || name, confidence });
    seen.add(el);
  }

  const scope = root.querySelector<HTMLElement>(APPLICATION_FORM_SELECTOR) ?? root;
  for (const el of Array.from(scope.querySelectorAll<HTMLElement>('input, select, textarea'))) {
    if (seen.has(el)) continue;
    if (!isFillable(el)) continue;
    if (isReservedSlot(el)) continue;

    const ctx = collectContext(el);
    const classified = isQuestionnaireField(el)
      ? classifyQuestionnaire(el, ctx.label)
      : classifyByHeuristics(el, ctx);
    if (!classified) continue;
    out.push({ el, kind: classified.kind, label: ctx.label, confidence: classified.confidence });
  }

  return out;
}

function detectAll(root: Document): DetectionResult {
  const classified = detectFields(root);
  const form = root.querySelector(APPLICATION_FORM_SELECTOR);
  const unclassified = findUnclassifiedFields(root, classified)
    .filter((u) => !isReservedSlot(u.el))
    .filter((u) => !form || form.contains(u.el))
    .map(withoutPlaceholderOption);
  return { classified, unclassified };
}

function classifyQuestionnaire(
  el: HTMLElement,
  label: string,
): { kind: FieldKind; confidence: number } | null {
  if (el instanceof HTMLTextAreaElement) {
    if (/cover\s*letter/i.test(label)) return { kind: 'coverLetter', confidence: 0.85 };
    return { kind: 'openEnded', confidence: 0.6 };
  }
  const hit = fromKeywords(normalize(label));
  if (!hit || !QUESTIONNAIRE_KINDS.has(hit.kind)) return null;
  return hit;
}

function isQuestionnaireField(el: HTMLElement): boolean {
  const name = el.getAttribute('name') ?? '';
  const id = el.getAttribute('id') ?? '';
  return (
    name.startsWith('resumator-questionnaire') || id.startsWith('resumator-questionnaire')
  );
}

function isReservedSlot(el: HTMLElement): boolean {
  const name = el.getAttribute('name') ?? '';
  const id = el.getAttribute('id') ?? '';
  return RESERVED_NAMES.has(name) || RESERVED_NAMES.has(id);
}

function withoutPlaceholderOption(u: UnclassifiedField): UnclassifiedField {
  if (!(u.el instanceof HTMLSelectElement)) return u;
  const options = Array.from(u.el.options)
    .filter((o) => o.value !== NO_SELECTION_VALUE)
    .map((o) => (o.textContent ?? '').trim())
    .filter((t) => t.length > 0);
  return { ...u, options };
}

async function fillResume(file: File, root: Document): Promise<boolean> {
  return attachResumeViaSlot(file, root, pickResumeSlot);
}

function pickResumeSlot(doc: Document): HTMLInputElement | null {
  const input = doc.getElementById(RESUME_FILE_ID);
  if (!(input instanceof HTMLInputElement) || input.type !== 'file' || input.disabled) {
    return findResumeInput(doc);
  }
  revealResumeUpload(doc);
  return input;
}

function revealResumeUpload(doc: Document): void {
  const pasted = doc.getElementById(RESUME_TEXT_ID);
  if (pasted instanceof HTMLTextAreaElement && pasted.value.trim().length > 0) return;
  const toggle = doc.getElementById(RESUME_UPLOAD_TOGGLE_ID);
  if (toggle instanceof HTMLElement) toggle.click();
}
