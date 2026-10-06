import type {
  DetectedField,
  DetectionResult,
  FieldGroup,
  FieldKind,
  HistoryEditor,
  HistoryEntrySummary,
  HistoryGroupKind,
  PlatformAdapter,
  UnclassifiedField,
} from './types';
import { isSelfIdKind } from './types';
import {
  attachResumeViaSlot,
  deepQueryAll,
  fromKeywords,
  hasSubmissionConfirmText,
  isFillable,
  normalize,
  pickJobDescriptionByCss,
  textOf,
  type Classification,
} from './_shared';

const HOST_RE = /(^|\.)smartrecruiters\.com$/i;

const APP_ROOT_SELECTOR = 'oc-oneclick-form-root, sr-screening-questions-form';

const HISTORY_SCOPE = 'oc-experience, oc-education';

const RESUME_DROPZONE = 'spl-dropzone[data-test="resume-upload"]';

const CONFIRMED_PATH_RE = /\/(confirmation|success|thank-?you)\/?$/i;

const PERSONAL_KINDS: Readonly<Record<string, FieldKind>> = {
  firstName: 'firstName',
  lastName: 'lastName',
  email: 'email',
  emailConfirmation: 'email',
  linkedIn: 'linkedin',
  twitter: 'twitter',
  website: 'portfolio',
  message: 'openEnded',
};

const QUESTION_CONTROL_SELECTOR =
  'spl-autocomplete, spl-multiselect-autocomplete, spl-input, spl-textarea, spl-checkbox';

const READ_DEFINITIONS_RE = /\(\s*\[?read definitions\]?(?:\([^)]*\))?\s*\)/gi;

const SOMEONE_ELSE_RE = /\b(household|spouse|family member)\b/i;

type FormFieldSpec = {
  host: string;
  control: string;
  kind: FieldKind;
  widget?: 'shadowCombobox' | 'monthYearPicker';
};

type SectionSpec = {
  section: string;
  entry: string;
  add: string;
  form: string;
  save: string;
  remove: string;
  title: string;
  detail: string;
  fields: ReadonlyArray<FormFieldSpec>;
};

const TEXT_CONTROL = 'input, textarea';
const DATE_CONTROL = 'input[type="text"]';

const SECTIONS: Readonly<Record<HistoryGroupKind, SectionSpec>> = {
  experience: {
    section: 'oc-experience',
    entry: 'oc-experience-entry',
    add: 'oc-button[data-test="add-experience"] spl-button',
    form: '[data-test="experience-edit-form"]',
    save: 'oc-button[data-test="experience-save"] spl-button',
    remove: 'spl-button[data-test="experience-entry-delete"]',
    title: '[data-test="experience-entry-title"]',
    detail: '[data-test="experience-entry-company"]',
    fields: [
      {
        host: 'spl-autocomplete[data-test="job-title-autocomplete"]',
        control: TEXT_CONTROL,
        kind: 'jobTitle',
        widget: 'shadowCombobox',
      },
      {
        host: 'spl-autocomplete[data-test="company-autocomplete"]',
        control: TEXT_CONTROL,
        kind: 'employer',
        widget: 'shadowCombobox',
      },
      {
        host: 'spl-autocomplete[data-test="location-autocomplete"]',
        control: TEXT_CONTROL,
        kind: 'employerLocation',
        widget: 'shadowCombobox',
      },
      {
        host: 'oc-textarea[formcontrolname="description"] spl-textarea',
        control: TEXT_CONTROL,
        kind: 'roleDescription',
      },
      {
        host: 'oc-datepicker[formcontrolname="startDate"] spl-date-field',
        control: DATE_CONTROL,
        kind: 'startDate',
        widget: 'monthYearPicker',
      },
      {
        host: 'oc-checkbox[formcontrolname="current"] spl-checkbox',
        control: 'input[type="checkbox"]',
        kind: 'currentlyEmployed',
      },
      {
        host: 'oc-datepicker[formcontrolname="endDate"] spl-date-field',
        control: DATE_CONTROL,
        kind: 'endDate',
        widget: 'monthYearPicker',
      },
    ],
  },
  education: {
    section: 'oc-education',
    entry: 'oc-education-entry',
    add: 'oc-button[data-test="add-education"] spl-button',
    form: '[data-test="education-edit-form"]',
    save: 'oc-button[data-test="education-save"] spl-button',
    remove: 'spl-button[data-test="education-entry-delete"]',
    title: '[data-test="education-entry-institution"]',
    detail: '[data-test="education-entry-major"]',
    fields: [
      {
        host: 'spl-autocomplete[data-test="institution-autocomplete"]',
        control: TEXT_CONTROL,
        kind: 'school',
        widget: 'shadowCombobox',
      },
      {
        host: 'oc-input[formcontrolname="major"] spl-input',
        control: TEXT_CONTROL,
        kind: 'fieldOfStudy',
      },
      {
        host: 'oc-input[formcontrolname="degree"] spl-input',
        control: TEXT_CONTROL,
        kind: 'degree',
      },
      {
        host: 'oc-datepicker[formcontrolname="startDate"] spl-date-field',
        control: DATE_CONTROL,
        kind: 'startDate',
        widget: 'monthYearPicker',
      },
      {
        host: 'oc-datepicker[formcontrolname="endDate"] spl-date-field',
        control: DATE_CONTROL,
        kind: 'endDate',
        widget: 'monthYearPicker',
      },
    ],
  },
};

const historyEditor: HistoryEditor = {
  newEntryFirst: true,
  entries: (root, kind) => {
    const spec = SECTIONS[kind];
    return Array.from(
      root.querySelectorAll<HTMLElement>(`${spec.section} ${spec.entry}`),
    ).filter((entry) => !entry.querySelector(spec.form));
  },
  openForm: (root, kind) => {
    const spec = SECTIONS[kind];
    return root.querySelector<HTMLElement>(`${spec.section} ${spec.form}`);
  },
  addButton: (root, kind) => {
    const spec = SECTIONS[kind];
    return innerButton(root.querySelector<HTMLElement>(`${spec.section} ${spec.add}`));
  },
  removeButton: (entry) => {
    return innerButton(entry.querySelector<HTMLElement>(SECTIONS[sectionOf(entry)].remove));
  },
  confirmRemoveButton: (root) => {
    const dialog = root.querySelector<HTMLElement>('spl-dialog[open]');
    if (!dialog) return null;
    const confirm = Array.from(dialog.querySelectorAll<HTMLElement>('spl-button')).find(
      (b) => b.getAttribute('type') === 'primary',
    );
    return innerButton(confirm ?? null);
  },
  saveButton: (form) => {
    const kind: HistoryGroupKind = form.closest(SECTIONS.education.section)
      ? 'education'
      : 'experience';
    const spec = SECTIONS[kind];
    const scope = form.closest<HTMLElement>(spec.entry) ?? form;
    return innerButton(scope.querySelector<HTMLElement>(spec.save));
  },
  formFields: (form, group) => formFields(form, group),
  summary: (entry) => summary(entry),
};

export const smartRecruitersAdapter: PlatformAdapter = {
  id: 'smartrecruiters',
  name: 'SmartRecruiters',
  matches: (url, doc) => {
    if (HOST_RE.test(url.hostname)) return true;
    return !!doc.querySelector(APP_ROOT_SELECTOR);
  },
  detectFields,
  detectAll,
  historyEditor,
  fillResume,
  resumeAttached,
  getJobDescription,
  detectSubmissionConfirmed,
};

function detectFields(root: Document): DetectedField[] {
  return [...detectPersonal(root), ...detectScreening(root).classified];
}

function detectAll(root: Document): DetectionResult {
  return {
    classified: detectFields(root),
    unclassified: [...unclassifiedPersonal(root), ...detectScreening(root).unclassified],
  };
}

function personalWrappers(root: Document): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'oc-input[formcontrolname], oc-textarea[formcontrolname]',
    ),
  ).filter((wrapper) => !wrapper.closest(HISTORY_SCOPE));
}

function detectPersonal(root: Document): DetectedField[] {
  const out: DetectedField[] = [];
  for (const wrapper of personalWrappers(root)) {
    const kind = PERSONAL_KINDS[wrapper.getAttribute('formcontrolname') ?? ''];
    if (!kind) continue;
    const host = wrapper.querySelector<HTMLElement>('spl-input, spl-textarea');
    const control = host ? firstControl(host, TEXT_CONTROL) : null;
    if (!host || !control) continue;
    out.push({ el: control, kind, label: hostLabel(host), confidence: 0.95 });
  }

  const city = root.querySelector<HTMLElement>('oc-personal-information spl-autocomplete');
  if (city && firstControl(city, TEXT_CONTROL)) {
    out.push({
      el: city,
      kind: 'cityAndRegion',
      label: hostLabel(city),
      confidence: 0.9,
      widget: 'shadowCombobox',
    });
  }

  const phone = root.querySelector<HTMLElement>('oc-phone-number spl-phone-field');
  const tel = phone ? firstControl(phone, 'input[type="tel"]') : null;
  if (phone && tel) {
    out.push({
      el: tel,
      kind: 'phoneNational',
      label: hostLabel(phone) || 'Phone number',
      confidence: 0.9,
    });
  }
  return out;
}

function unclassifiedPersonal(root: Document): UnclassifiedField[] {
  const out: UnclassifiedField[] = [];
  for (const wrapper of personalWrappers(root)) {
    if (PERSONAL_KINDS[wrapper.getAttribute('formcontrolname') ?? '']) continue;
    const host = wrapper.querySelector<HTMLElement>('spl-input');
    const control = host ? firstControl(host, 'input') : null;
    if (!host || !control) continue;
    const label = hostLabel(host);
    if (label) out.push({ el: control, label, fieldType: 'text' });
  }
  return out;
}

function detectScreening(root: Document): DetectionResult {
  const classified: DetectedField[] = [];
  const unclassified: UnclassifiedField[] = [];
  for (const host of screeningHosts(root)) {
    const label = hostLabel(host);
    if (!label) continue;
    const tag = host.tagName.toLowerCase();

    if (tag === 'spl-autocomplete') {
      if (!firstControl(host, TEXT_CONTROL)) continue;
      const hit = classifyQuestion(label, 'select');
      if (hit) {
        classified.push({
          el: host,
          kind: hit.kind,
          label,
          confidence: hit.confidence,
          widget: 'shadowCombobox',
        });
      } else {
        unclassified.push({ el: host, label, fieldType: 'combobox', widget: 'shadowCombobox' });
      }
      continue;
    }

    if (tag === 'spl-input' || tag === 'spl-textarea') {
      const control = firstControl(host, TEXT_CONTROL);
      if (!control) continue;
      const hit = classifyQuestion(label, 'text');
      if (hit) {
        classified.push({ el: control, kind: hit.kind, label, confidence: hit.confidence });
      } else {
        const fieldType = control instanceof HTMLTextAreaElement ? 'textarea' : 'text';
        unclassified.push({ el: control, label, fieldType });
      }
    }
  }
  return { classified, unclassified };
}

function screeningHosts(root: Document): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const form of Array.from(root.querySelectorAll('sr-screening-questions-form'))) {
    const scope = form.shadowRoot;
    if (!scope) continue;
    for (const container of Array.from(
      scope.querySelectorAll<HTMLElement>('[data-test="question-container"]'),
    )) {
      const host = container.querySelector<HTMLElement>(QUESTION_CONTROL_SELECTOR);
      if (host) out.push(host);
    }
  }
  return out;
}

function classifyQuestion(label: string, control: 'select' | 'text'): Classification | null {
  if (SOMEONE_ELSE_RE.test(label)) return null;
  const hit = fromKeywords(normalize(label));
  if (!hit) return null;
  if (isSelfIdKind(hit.kind) && control !== 'select') return null;
  if (hit.kind === 'lastName' && /\bpreferred\b/i.test(label)) return null;
  return hit;
}

function formFields(form: HTMLElement, group: FieldGroup): DetectedField[] {
  const out: DetectedField[] = [];
  for (const spec of SECTIONS[group.kind].fields) {
    const host = form.querySelector<HTMLElement>(spec.host);
    if (!host) continue;
    const control = firstControl(host, spec.control);
    if (!control) continue;
    out.push({
      el: spec.widget === 'shadowCombobox' ? host : control,
      kind: spec.kind,
      label: hostLabel(host),
      confidence: 0.95,
      group,
      ...(spec.widget ? { widget: spec.widget } : {}),
    });
  }
  return out;
}

function summary(entry: HTMLElement): HistoryEntrySummary {
  const spec = SECTIONS[sectionOf(entry)];
  return {
    title: ownText(entry.querySelector(spec.title)),
    detail: ownText(entry.querySelector(spec.detail)),
  };
}

function sectionOf(entry: HTMLElement): HistoryGroupKind {
  return entry.matches(SECTIONS.education.entry) ? 'education' : 'experience';
}

function ownText(el: Element | null): string {
  if (!el) return '';
  const parts: string[] = [];
  for (const node of Array.from(el.childNodes)) {
    if (node instanceof Element && node.matches('[data-test$="-date"]')) continue;
    parts.push(node.textContent ?? '');
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

function firstControl(
  host: HTMLElement,
  selector: string,
): HTMLInputElement | HTMLTextAreaElement | null {
  const control = deepQueryAll<HTMLInputElement | HTMLTextAreaElement>(host, selector)[0];
  if (!control) return null;
  if (control instanceof HTMLInputElement && control.type === 'checkbox') {
    return control.disabled ? null : control;
  }
  return isFillable(control) ? control : null;
}

function hostLabel(host: HTMLElement): string {
  const slotted = host.querySelector(':scope > [slot="label-content"]');
  const raw = slotted ? textOf(slotted) : host.getAttribute('label') || textOf(host);
  const label = raw.replace(READ_DEFINITIONS_RE, ' ').replace(/\s+/g, ' ').trim();
  if (!label) return '';
  return host.hasAttribute('required') && !label.endsWith('*') ? `${label} *` : label;
}

function innerButton(host: HTMLElement | null): HTMLElement | null {
  if (!host) return null;
  return host.shadowRoot?.querySelector<HTMLElement>('button') ?? null;
}

async function fillResume(file: File, root: Document): Promise<boolean> {
  return attachResumeViaSlot(file, root, (doc) => {
    const zone = doc.querySelector<HTMLElement>(RESUME_DROPZONE);
    if (!zone) return null;
    return (
      deepQueryAll<HTMLInputElement>(zone, 'input[type="file"]').find((i) => !i.disabled) ??
      null
    );
  });
}

function resumeAttached(root: Document): boolean {
  const listed = root.querySelector(RESUME_DROPZONE)?.getAttribute('files');
  if (!listed) return false;
  try {
    const files: unknown = JSON.parse(listed);
    return Array.isArray(files) && files.length > 0;
  } catch {
    return false;
  }
}

function getJobDescription(doc: Document): string {
  return pickJobDescriptionByCss(doc, ['[itemprop="description"]']);
}

function detectSubmissionConfirmed(doc: Document, url: URL): boolean {
  if (CONFIRMED_PATH_RE.test(url.pathname)) return true;
  const formGone = !doc.querySelector('oc-oneclick-form, oc-screening-questions');
  return formGone && hasSubmissionConfirmText(doc);
}
