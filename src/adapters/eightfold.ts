import type {
  PlatformAdapter,
  DetectedField,
  DetectionResult,
  FieldKind,
  UnclassifiedField,
} from './types';
import {
  attachResumeViaSlot,
  bestLabel,
  clipJobDescription,
  findResumeInput,
  fromKeywords,
  hasSubmissionConfirmText,
  isFillable,
  normalize,
  textOf,
  type Classification,
} from './_shared';
import { jobPostingDescription } from '@/content/job-context';

const EIGHTFOLD_HOST_RE = /(^|\.)eightfold\.ai$/i;
const SECTION_SELECTOR = 'fieldset[data-form-section-id]';
const SUBMIT_SELECTOR = '[data-test-id="submitApplicationButton"]';
const RESUME_DROPZONE_SELECTOR = '.upload-resume-dropzone input[type="file"]';
const SUCCESS_IMAGE_SELECTOR = 'img[src*="application-submitted-confirmation"]';
const SUCCESS_PATH_RE = /\/success\/?$/;
const COUNTRY_CODE_SUFFIX = '-country-code';
const ETHNICITY_LABEL_RE = /^ethnicity$/;

const PLATFORM_FIELDS: Readonly<Record<string, FieldKind>> = {
  firstname: 'firstName',
  lastname: 'lastName',
  email: 'email',
  phone: 'phone',
  q_addressLine1: 'addressLine1',
  q_city: 'city',
  q_zip: 'postalCode',
  q_country: 'country',
};

const CHOICE_KINDS: ReadonlySet<FieldKind> = new Set<FieldKind>([
  'authorizedToWorkInUS',
  'requiresSponsorship',
  'willingToRelocate',
  'gender',
  'pronouns',
  'ethnicity',
  'race',
  'sexualOrientation',
  'transgender',
  'veteranStatus',
  'disabilityStatus',
]);

const LINK_KINDS: ReadonlySet<FieldKind> = new Set<FieldKind>([
  'linkedin',
  'github',
  'portfolio',
  'twitter',
]);

type Control = 'text' | 'textarea' | 'radio' | 'select';

type FormField = { el: HTMLElement; key: string; label: string; control: Control };

export const eightfoldAdapter: PlatformAdapter = {
  id: 'eightfold',
  name: 'Eightfold',
  matches: (url, doc) =>
    EIGHTFOLD_HOST_RE.test(url.hostname) || !!doc.querySelector(`form ${SECTION_SELECTOR}`),
  detectFields: (root) => detectAll(root).classified,
  detectAll,
  fillResume,
  getJobDescription,
  detectSubmissionConfirmed,
};

function detectAll(root: Document): DetectionResult {
  const fields = formFields(root);
  const hasCountryCode = fields.some((f) => f.key.endsWith(COUNTRY_CODE_SUFFIX));
  const classified: DetectedField[] = [];
  const unclassified: UnclassifiedField[] = [];
  for (const field of fields) {
    const hit = classify(field, hasCountryCode);
    if (!hit) {
      unclassified.push(unclassifiedOf(field));
      continue;
    }
    classified.push({
      el: field.el,
      kind: hit.kind,
      label: field.label,
      confidence: hit.confidence,
      ...(field.control === 'select' ? { widget: 'clickListbox' as const } : {}),
    });
  }
  return { classified, unclassified };
}

function unclassifiedOf({ el, label, control }: FormField): UnclassifiedField {
  switch (control) {
    case 'radio':
      return { el, label, fieldType: 'radio', options: radioOptions(el) };
    case 'select':
      return { el, label, fieldType: 'combobox', widget: 'clickListbox' };
    default:
      return { el, label, fieldType: control };
  }
}

function radioOptions(rep: HTMLElement): string[] {
  const group = rep.closest('[role="radiogroup"]');
  if (!group) return [];
  return Array.from(group.querySelectorAll<HTMLInputElement>('input[type="radio"]'))
    .map((r) => bestLabel(r).trim())
    .filter((s) => s.length > 0);
}

function formFields(root: Document): FormField[] {
  const out: FormField[] = [];
  const seen = new Set<string>();
  for (const section of Array.from(root.querySelectorAll<HTMLElement>(SECTION_SELECTOR))) {
    const prefix = `${(section.getAttribute('data-form-section-id') ?? '').replace(/\s+/g, '_')}_`;
    for (const el of Array.from(section.querySelectorAll<HTMLElement>('input, textarea'))) {
      const control = controlOf(el);
      if (!control || !isFillable(el)) continue;
      const id = fieldIdOf(el, control);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push({
        el,
        key: id.startsWith(prefix) ? id.slice(prefix.length) : id,
        label: labelOf(root, id) || bestLabel(el),
        control,
      });
    }
  }
  return out;
}

function controlOf(el: HTMLElement): Control | null {
  if (el instanceof HTMLTextAreaElement) return 'textarea';
  if (!(el instanceof HTMLInputElement)) return null;
  if (el.type === 'radio') return 'radio';
  if (el.getAttribute('role') === 'combobox') return 'select';
  return el.type === 'text' || el.type === 'email' || el.type === 'tel' ? 'text' : null;
}

function fieldIdOf(el: HTMLElement, control: Control): string {
  if (control === 'radio') return el.closest('[role="radiogroup"]')?.id ?? '';
  return el.closest('[data-test-id]')?.getAttribute('data-test-id') ?? '';
}

function labelOf(root: Document, id: string): string {
  const label = root.getElementById(`${id}_label`) ?? root.getElementById(`${id}_legend`);
  return label ? textOf(label) : '';
}

function classify(field: FormField, hasCountryCode: boolean): Classification | null {
  if (field.key.endsWith(COUNTRY_CODE_SUFFIX)) return { kind: 'phoneCountry', confidence: 0.95 };
  const platform = PLATFORM_FIELDS[field.key];
  if (platform === 'phone' && hasCountryCode) return { kind: 'phoneNational', confidence: 0.95 };
  if (platform) return { kind: platform, confidence: 0.95 };

  const plain = normalize(withoutAsides(field.label));
  switch (field.control) {
    case 'textarea':
      return /cover\s*letter/.test(plain)
        ? { kind: 'coverLetter', confidence: 0.85 }
        : { kind: 'openEnded', confidence: 0.7 };
    case 'radio':
    case 'select': {
      const hit = fromKeywords(plain);
      if (hit && CHOICE_KINDS.has(hit.kind)) return hit;
      return ETHNICITY_LABEL_RE.test(plain) ? { kind: 'ethnicity', confidence: 0.7 } : null;
    }
    case 'text': {
      const hit = fromKeywords(plain);
      return hit && LINK_KINDS.has(hit.kind) ? hit : null;
    }
  }
}

function withoutAsides(label: string): string {
  return label.replace(/\([^)]*\)/g, ' ');
}

async function fillResume(file: File, root: Document): Promise<boolean> {
  return attachResumeViaSlot(file, root, (d) => {
    const dropzone = d.querySelector<HTMLInputElement>(RESUME_DROPZONE_SELECTOR);
    if (dropzone && !dropzone.disabled) return dropzone;
    return findResumeInput(d);
  });
}

function getJobDescription(doc: Document): string {
  return clipJobDescription(jobPostingDescription(doc));
}

function detectSubmissionConfirmed(doc: Document, url: URL): boolean {
  if (SUCCESS_PATH_RE.test(url.pathname)) return true;
  if (doc.querySelector(SUBMIT_SELECTOR)) return false;
  if (doc.querySelector(SUCCESS_IMAGE_SELECTOR)) return true;
  return hasSubmissionConfirmText(doc);
}
