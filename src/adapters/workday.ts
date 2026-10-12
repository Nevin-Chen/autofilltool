import {
  historyKindFor,
  isSelfIdKind,
  isSharedHistoryKind,
  type DetectedField,
  type FieldKind,
  type HistoryGroupKind,
  type PlatformAdapter,
  type SiteAnswer,
  type UnclassifiedField,
} from './types';
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
  bestLabel,
  normalize,
  withoutExceptionClauses,
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

const CHECKBOX_KINDS: ReadonlySet<FieldKind> = new Set<FieldKind>(['currentlyEmployed']);

const FORM_FIELD_KINDS: ReadonlyMap<string, FieldKind> = new Map([
  ['legalName--firstName', 'firstName'],
  ['legalName--lastName', 'lastName'],
  ['country', 'country'],
  ['addressLine1', 'addressLine1'],
  ['addressLine2', 'addressLine2'],
  ['city', 'city'],
  ['countryRegion', 'region'],
  ['postalCode', 'postalCode'],
  ['countryPhoneCode', 'phoneCountry'],
  ['phoneNumber', 'phoneNational'],
  ['jobTitle', 'jobTitle'],
  ['companyName', 'employer'],
  ['location', 'employerLocation'],
  ['currentlyWorkHere', 'currentlyEmployed'],
  ['roleDescription', 'roleDescription'],
  ['school', 'school'],
  ['schoolName', 'school'],
  ['degree', 'degree'],
  ['fieldOfStudy', 'fieldOfStudy'],
  ['gradeAverage', 'gpa'],
  ['linkedInAccount', 'linkedin'],
]);

const LEFT_BLANK_FORM_FIELDS: ReadonlySet<string> = new Set([
  'legalName--title',
  'legalName--middleName',
  'legalName--social',
  'preferredCheck',
  'regionSubdivision1',
  'extension',
  'skills',
]);

const pickOption =
  (option: RegExp) =>
  (options: string[]): string | null =>
    options.find((text) => option.test(text.trim())) ?? null;

const FIELD_DEFAULTS: ReadonlyArray<{
  name: string;
  kind: FieldKind;
  answer: (options: string[]) => string | null;
}> = [
  { name: 'source', kind: 'referralSource', answer: () => 'LinkedIn' },
  { name: 'phoneType', kind: 'phoneType', answer: pickOption(/^(mobile|cell)/i) },
];

const QUESTION_DEFAULTS: ReadonlyArray<{
  question: RegExp;
  answer: (options: string[]) => string | null;
}> = [
  { question: /\b18 years of age\b|\bat least 18\b/i, answer: pickOption(/^yes\b/i) },
  { question: /\bdrug (test|screen)/i, answer: pickOption(/^yes\b/i) },
  { question: /\bcontact method\b|\bpreferred method of contact\b/i, answer: pickOption(/^e-?mail$/i) },
  {
    question: /\b(sms|text messages?|text notifications?)\b/i,
    answer: pickOption(/\b(do not|don't)\b|^no\b/i),
  },
];

const PROFILE_QUESTION_KINDS: ReadonlySet<FieldKind> = new Set<FieldKind>([
  'authorizedToWorkInUS',
  'requiresSponsorship',
  'willingToRelocate',
]);

const CROSS_REFERENCE_RE = /\bquestions?\s*#?\d/i;
const FOOTNOTE_RE = /^\*+\s*\S/;
const RICH_TEXT_PARAGRAPHS = '[data-automation-id="richText"] > p';

const TODAY_DATE_RE = /\btoday['’]?s date\b/i;
const DATE_INPUT_SELECTOR = '[data-automation-id="dateInputWrapper"]';
const TODAY_DATE_PARTS: ReadonlyArray<{ id: string; value: (today: Date) => string }> = [
  { id: 'dateSectionMonth-input', value: (today) => String(today.getMonth() + 1).padStart(2, '0') },
  { id: 'dateSectionDay-input', value: (today) => String(today.getDate()).padStart(2, '0') },
  { id: 'dateSectionYear-input', value: (today) => String(today.getFullYear()) },
];

const TERMS_FIELD = 'acceptTermsAndAgreements';
const TERMS_LABEL_RE = /\baccept\b.*\bterms\b/i;

const LANGUAGE_FIELD = 'language';
const FLUENT_FIELD = 'native';
const LANGUAGE_ANSWER = 'English';
const PROFICIENCY_ANSWER = 'Fluent';

const FORM_FIELD_PREFIX = 'formField-';

const HISTORY_SECTIONS: ReadonlyArray<{
  kind: HistoryGroupKind;
  anchor: FieldKind;
  sectionId: string;
}> = [
  { kind: 'experience', anchor: 'jobTitle', sectionId: 'Work-Experience-section' },
  { kind: 'education', anchor: 'school', sectionId: 'Education-section' },
];

const PANEL_SELECTOR = '[role="group"][aria-labelledby$="-panel"]';
const SECTION_SELECTOR = '[role="group"][aria-labelledby$="-section"]';

const DATE_CONTAINER_MAP: ReadonlyArray<{ id: string; kind: FieldKind }> = [
  { id: 'startDate', kind: 'startDate' },
  { id: 'fromDate', kind: 'startDate' },
  { id: 'endDate', kind: 'endDate' },
  { id: 'toDate', kind: 'endDate' },
];

const DATE_PART_IDS: ReadonlyArray<{ id: string; part: 'month' | 'year' }> = [
  { id: 'dateSectionYear-input', part: 'year' },
  { id: 'dateSectionMonth-input', part: 'month' },
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

function fitsControl(el: HTMLElement, kind: FieldKind): boolean {
  const isCheckbox = el instanceof HTMLInputElement && el.type === 'checkbox';
  return !isCheckbox || CHECKBOX_KINDS.has(kind);
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
    if (/(^|\.)myworkday(jobs|site)\.com$/.test(url.hostname)) return true;
    return !!doc.querySelector('[data-automation-id]');
  },
  detectFields,
  detectAll: (root) => {
    const result = defaultDetectAll({ detectFields }, root);
    return { ...result, unclassified: result.unclassified.flatMap(asQuestion) };
  },
  historyPanels: { panels: panelsFor, addButton: addButtonFor },
  fillResume,
  siteAnswers,
  getJobDescription,
  detectSubmissionConfirmed,
  pageKey,
  recheckAfterMs: 1500,
};

function historySection(root: ParentNode, kind: HistoryGroupKind): HTMLElement | null {
  const section = HISTORY_SECTIONS.find((s) => s.kind === kind)!;
  const anchor = formFieldWrappers(root).find(
    (wrapper) => FORM_FIELD_KINDS.get(formFieldName(wrapper)) === section.anchor,
  );
  return (
    anchor?.closest<HTMLElement>(SECTION_SELECTOR) ??
    root.querySelector<HTMLElement>(`[role="group"][aria-labelledby="${section.sectionId}"]`)
  );
}

function panelsFor(root: ParentNode, kind: HistoryGroupKind): HTMLElement[] {
  const section = historySection(root, kind);
  return section ? Array.from(section.querySelectorAll<HTMLElement>(PANEL_SELECTOR)) : [];
}

function addButtonFor(root: ParentNode, kind: HistoryGroupKind): HTMLElement | null {
  const section = historySection(root, kind);
  if (!section) return null;
  return (
    Array.from(
      section.querySelectorAll<HTMLElement>('[data-automation-id="add-button"]'),
    ).find((button) => !button.closest(PANEL_SELECTOR)) ?? null
  );
}

function withPanelGroups(root: Document, fields: DetectedField[]): DetectedField[] {
  const sections = HISTORY_SECTIONS.map(({ kind }) => ({ kind, panels: panelsFor(root, kind) }));
  return fields.map((field) => {
    if (!historyKindFor(field.kind) && !isSharedHistoryKind(field.kind)) return field;
    for (const { kind, panels } of sections) {
      const index = panels.findIndex((panel) => panel.contains(field.el));
      if (index !== -1) return { ...field, group: { kind, index } };
    }
    return field;
  });
}

const STEP_PAGE_RE = /^applyFlow\w+Page$/;

function pageKey(doc: Document): string | null {
  for (const el of Array.from(doc.querySelectorAll('[data-automation-id^="applyFlow"]'))) {
    const id = el.getAttribute('data-automation-id') ?? '';
    if (id !== 'applyFlowPage' && STEP_PAGE_RE.test(id)) return id;
  }
  return null;
}

function formFieldWrappers(root: ParentNode): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(`[data-automation-id^="${FORM_FIELD_PREFIX}"]`),
  );
}

function formFieldName(wrapper: HTMLElement): string {
  return (wrapper.getAttribute('data-automation-id') ?? '').slice(FORM_FIELD_PREFIX.length);
}

function wrapperOf(el: HTMLElement): HTMLElement | null {
  return el.closest<HTMLElement>(`[data-automation-id^="${FORM_FIELD_PREFIX}"]`);
}

function asQuestion(field: UnclassifiedField): UnclassifiedField[] {
  const wrapper = wrapperOf(field.el);
  if (!wrapper) return [field];
  if (isLeftForSiteOrUser(wrapper) || field.el.closest(DATE_INPUT_SELECTOR)) return [];
  const label = formFieldLabel(wrapper) || field.label;
  if (field.el === searchPromptInput(wrapper)) {
    return [{ el: field.el, label, fieldType: 'combobox', widget: 'searchPrompt' }];
  }
  return [{ ...field, label }];
}

function isLeftForSiteOrUser(wrapper: HTMLElement): boolean {
  return (
    LEFT_BLANK_FORM_FIELDS.has(formFieldName(wrapper)) ||
    fieldDefault(wrapper) !== null ||
    isInLanguagePanel(wrapper) ||
    questionDefault(wrapper) !== null ||
    todayDateInputs(wrapper).length > 0 ||
    termsBox(wrapper) !== null
  );
}

function fieldDefault(wrapper: HTMLElement): (typeof FIELD_DEFAULTS)[number] | null {
  const name = formFieldName(wrapper);
  return FIELD_DEFAULTS.find((d) => d.name === name) ?? null;
}

function termsBox(wrapper: HTMLElement): HTMLInputElement | null {
  const box = wrapper.querySelector<HTMLInputElement>('input[type="checkbox"]');
  if (!box) return null;
  const named = formFieldName(wrapper) === TERMS_FIELD;
  return named || TERMS_LABEL_RE.test(formFieldLabel(wrapper)) ? box : null;
}

function formFieldLabel(wrapper: HTMLElement): string {
  const heading = wrapper.querySelector('label, legend');
  if (!heading) return '';
  const paragraphs = Array.from(heading.querySelectorAll(RICH_TEXT_PARAGRAPHS)).map(squash);
  if (paragraphs.length === 0) return squash(heading);
  return paragraphs.filter((text) => text && !FOOTNOTE_RE.test(text)).join(' ');
}

function squash(node: Element): string {
  return (node.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function todayDateInputs(wrapper: HTMLElement): Array<{ el: HTMLInputElement; value: string }> {
  if (!wrapper.querySelector(DATE_INPUT_SELECTOR) || !TODAY_DATE_RE.test(formFieldLabel(wrapper))) {
    return [];
  }
  const today = new Date();
  return TODAY_DATE_PARTS.flatMap(({ id, value }) => {
    const el = wrapper.querySelector<HTMLInputElement>(`input[data-automation-id="${id}"]`);
    return el ? [{ el, value: value(today) }] : [];
  });
}

function questionDefault(wrapper: HTMLElement): (typeof QUESTION_DEFAULTS)[number] | null {
  if (!listboxButton(wrapper) && radioOptions(wrapper).length === 0) return null;
  const label = formFieldLabel(wrapper);
  return QUESTION_DEFAULTS.find((d) => d.question.test(label)) ?? null;
}

function radioOptions(wrapper: HTMLElement): HTMLInputElement[] {
  return Array.from(wrapper.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
}

function isChecked(radio: HTMLInputElement): boolean {
  return radio.checked || radio.getAttribute('aria-checked') === 'true';
}

function listboxButton(wrapper: HTMLElement): HTMLElement | null {
  return wrapper.querySelector<HTMLElement>('button[aria-haspopup="listbox"]');
}

function isInLanguagePanel(el: HTMLElement): boolean {
  return !!el
    .closest(PANEL_SELECTOR)
    ?.querySelector(`[data-automation-id="${FORM_FIELD_PREFIX}${LANGUAGE_FIELD}"]`);
}

function searchPromptInput(wrapper: HTMLElement): HTMLInputElement | null {
  return wrapper.querySelector<HTMLInputElement>(
    '[data-automation-id="multiSelectContainer"] input:not([type="hidden"])',
  );
}

function formFieldControl(
  wrapper: HTMLElement,
): { el: HTMLElement; widget?: DetectedField['widget'] } | null {
  const prompt = searchPromptInput(wrapper);
  if (prompt) return { el: prompt, widget: 'searchPrompt' };
  const listbox = wrapper.querySelector<HTMLElement>('button[aria-haspopup="listbox"]');
  if (listbox) return { el: listbox, widget: 'virtualizedDropdown' };
  const input = Array.from(
    wrapper.querySelectorAll<HTMLElement>('input, select, textarea'),
  ).find(isFillable);
  return input ? { el: input } : null;
}

function claimControls(wrapper: HTMLElement, seen: WeakSet<HTMLElement>): void {
  for (const el of Array.from(
    wrapper.querySelectorAll<HTMLElement>('input, select, textarea, button'),
  )) {
    seen.add(el);
  }
}

function detectFormFields(
  root: Document,
  seen: WeakSet<HTMLElement>,
  handled: WeakSet<HTMLElement>,
): DetectedField[] {
  const out: DetectedField[] = [];
  for (const wrapper of formFieldWrappers(root)) {
    claimControls(wrapper, seen);
    handled.add(wrapper);
    if (isLeftForSiteOrUser(wrapper)) continue;
    out.push(...(platformFields(wrapper) ?? customQuestion(wrapper)));
  }
  return out;
}

function platformFields(wrapper: HTMLElement): DetectedField[] | null {
  const name = formFieldName(wrapper);
  const dateKind = DATE_CONTAINER_MAP.find((d) => d.id === name)?.kind;
  if (dateKind) return collectDateFields(wrapper, dateKind, formFieldLabel(wrapper) || name);
  const kind = FORM_FIELD_KINDS.get(name);
  if (!kind) return null;
  const control = formFieldControl(wrapper);
  if (!control) return [];
  return [
    {
      el: control.el,
      kind,
      label: collectContext(control.el).label || name,
      confidence: 0.99,
      ...(control.widget ? { widget: control.widget } : {}),
    },
  ];
}

function customQuestion(wrapper: HTMLElement): DetectedField[] {
  const question = formFieldLabel(wrapper);
  const control = questionControl(wrapper);
  if (!question || !control || CROSS_REFERENCE_RE.test(question)) return [];
  const classified = classifyByHeuristics(control.el, {
    ...collectContext(control.el),
    label: question,
    haystack: normalize(withoutExceptionClauses(question)),
  });
  if (!classified) return [];
  if (control.choice && !isProfileQuestionKind(classified.kind)) return [];
  return [
    {
      el: control.el,
      kind: classified.kind,
      label: question,
      confidence: classified.confidence,
      ...(control.widget ? { widget: control.widget } : {}),
    },
  ];
}

function questionControl(
  wrapper: HTMLElement,
): { el: HTMLElement; choice: boolean; widget?: DetectedField['widget'] } | null {
  const button = listboxButton(wrapper);
  if (button) return { el: button, choice: true, widget: 'virtualizedDropdown' };
  const radio = radioOptions(wrapper)[0];
  if (radio) return { el: radio, choice: true };
  if (wrapper.querySelector(DATE_INPUT_SELECTOR) || searchPromptInput(wrapper)) return null;
  const input = Array.from(
    wrapper.querySelectorAll<HTMLElement>('textarea, input:not([type="checkbox"])'),
  ).find(isFillable);
  return input ? { el: input, choice: false } : null;
}

function isProfileQuestionKind(kind: FieldKind): boolean {
  return PROFILE_QUESTION_KINDS.has(kind) || isSelfIdKind(kind);
}

function siteAnswers(root: Document): SiteAnswer[] {
  return [
    ...fieldDefaultAnswers(root),
    ...languageAnswers(root),
    ...questionAnswers(root),
    ...todayDateAnswers(root),
    ...termsAnswers(root),
  ];
}

function todayDateAnswers(root: Document): SiteAnswer[] {
  return formFieldWrappers(root).flatMap((wrapper) =>
    todayDateInputs(wrapper).map(({ el, value }) => ({
      field: { el, kind: 'screening' as const, label: formFieldLabel(wrapper), confidence: 0.9 },
      answer: () => value,
    })),
  );
}

function termsAnswers(root: Document): SiteAnswer[] {
  const out: SiteAnswer[] = [];
  for (const wrapper of formFieldWrappers(root)) {
    const box = termsBox(wrapper);
    if (!box) continue;
    out.push({
      field: {
        el: box,
        kind: 'agreement',
        label: formFieldLabel(wrapper) || 'Terms and Conditions',
        confidence: 0.9,
      },
      answer: () => true,
    });
  }
  return out;
}

function questionAnswers(root: Document): SiteAnswer[] {
  const out: SiteAnswer[] = [];
  for (const wrapper of formFieldWrappers(root)) {
    const preset = questionDefault(wrapper);
    if (!preset) continue;
    const field = { kind: 'screening' as const, label: formFieldLabel(wrapper), confidence: 0.9 };
    const button = listboxButton(wrapper);
    if (button) {
      if (!isUnsetDropdown(button)) continue;
      out.push({ field: { ...field, el: button, widget: 'virtualizedDropdown' }, answer: preset.answer });
      continue;
    }
    const radios = radioOptions(wrapper);
    if (radios.some(isChecked)) continue;
    const labels = radios.map(bestLabel);
    out.push({ field: { ...field, el: radios[0]! }, answer: () => preset.answer(labels) });
  }
  return out;
}

function fieldDefaultAnswers(root: Document): SiteAnswer[] {
  const out: SiteAnswer[] = [];
  for (const wrapper of formFieldWrappers(root)) {
    const preset = fieldDefault(wrapper);
    if (!preset) continue;
    const field = { kind: preset.kind, label: formFieldLabel(wrapper) || preset.name, confidence: 0.9 };
    const prompt = searchPromptInput(wrapper);
    if (prompt) {
      out.push({ field: { ...field, el: prompt, widget: 'searchPrompt' }, answer: preset.answer });
      continue;
    }
    const button = listboxButton(wrapper);
    if (button && isUnsetDropdown(button)) {
      out.push({ field: { ...field, el: button, widget: 'virtualizedDropdown' }, answer: preset.answer });
    }
  }
  return out;
}

function languageAnswers(root: Document): SiteAnswer[] {
  const wrapper = root.querySelector<HTMLElement>(
    `[data-automation-id="${FORM_FIELD_PREFIX}${LANGUAGE_FIELD}"]`,
  );
  const panel = wrapper?.closest<HTMLElement>(PANEL_SELECTOR);
  const language = wrapper?.querySelector<HTMLElement>('button[aria-haspopup="listbox"]');
  if (!panel || !language || !isUnsetDropdown(language)) return [];

  const answers = [languageAnswer(language, LANGUAGE_ANSWER, 'virtualizedDropdown')];
  const fluent = panel.querySelector<HTMLInputElement>(
    `[data-automation-id="${FORM_FIELD_PREFIX}${FLUENT_FIELD}"] input[type="checkbox"]`,
  );
  if (fluent) answers.push(languageAnswer(fluent, true));
  for (const button of Array.from(
    panel.querySelectorAll<HTMLElement>('button[aria-haspopup="listbox"]'),
  )) {
    if (button !== language) answers.push(languageAnswer(button, PROFICIENCY_ANSWER, 'virtualizedDropdown'));
  }
  return answers;
}

function languageAnswer(
  el: HTMLElement,
  value: string | boolean,
  widget?: DetectedField['widget'],
): SiteAnswer {
  return {
    field: {
      el,
      kind: 'language',
      label: collectContext(el).label || 'Language',
      confidence: 0.9,
      ...(widget ? { widget } : {}),
    },
    answer: () => value,
  };
}

function isUnsetDropdown(button: HTMLElement): boolean {
  const text = (button.textContent ?? '').trim();
  return text === '' || /^select\b/i.test(text);
}

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
  const seen = new WeakSet<HTMLElement>();
  const handled = new WeakSet<HTMLElement>();
  const out = detectFormFields(root, seen, handled);

  const tagged = root.querySelectorAll<HTMLElement>('[data-automation-id]');
  for (const el of Array.from(tagged)) {
    if (handled.has(el)) continue;
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
    if (!fitsControl(el, classified.kind)) continue;

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
    if (!classified || !fitsControl(el, classified.kind)) continue;
    out.push({ el, kind: classified.kind, label: ctx.label, confidence: classified.confidence });
  }

  return withPanelGroups(root, out);
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
