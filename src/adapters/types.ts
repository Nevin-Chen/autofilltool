import type { AdapterId } from '@/profile/schema';

export type FieldKind =
  | 'firstName'
  | 'lastName'
  | 'fullName'
  | 'preferredName'
  | 'email'
  | 'phone'
  | 'phoneCountry'
  | 'phoneNational'
  | 'addressLine1'
  | 'addressLine2'
  | 'city'
  | 'region'
  | 'cityAndRegion'
  | 'postalCode'
  | 'country'
  | 'linkedin'
  | 'github'
  | 'portfolio'
  | 'twitter'
  | 'otherLink'
  | 'authorizedToWorkInUS'
  | 'requiresSponsorship'
  | 'willingToRelocate'
  | 'desiredSalary'
  | 'gender'
  | 'pronouns'
  | 'ethnicity'
  | 'race'
  | 'sexualOrientation'
  | 'transgender'
  | 'veteranStatus'
  | 'disabilityStatus'
  | 'school'
  | 'degree'
  | 'fieldOfStudy'
  | 'gradYear'
  | 'gpa'
  | 'employer'
  | 'jobTitle'
  | 'employerLocation'
  | 'roleDescription'
  | 'currentlyEmployed'
  | 'startDate'
  | 'endDate'
  | 'coverLetter'
  | 'referralSource'
  | 'agreement'
  | 'openEnded';

export type HistoryGroupKind = 'experience' | 'education';

export type FieldGroup = { kind: HistoryGroupKind; index: number };

export const EXPERIENCE_KINDS = [
  'employer',
  'jobTitle',
  'employerLocation',
  'roleDescription',
  'currentlyEmployed',
] as const satisfies ReadonlyArray<FieldKind>;

export const EDUCATION_KINDS = [
  'school',
  'degree',
  'fieldOfStudy',
  'gradYear',
  'gpa',
] as const satisfies ReadonlyArray<FieldKind>;

export const SHARED_HISTORY_KINDS = [
  'startDate',
  'endDate',
] as const satisfies ReadonlyArray<FieldKind>;

export function historyKindFor(kind: FieldKind): HistoryGroupKind | null {
  if ((EXPERIENCE_KINDS as ReadonlyArray<string>).includes(kind)) {
    return 'experience';
  }
  if ((EDUCATION_KINDS as ReadonlyArray<string>).includes(kind)) {
    return 'education';
  }
  return null;
}

export function isSharedHistoryKind(kind: FieldKind): boolean {
  return (SHARED_HISTORY_KINDS as ReadonlyArray<string>).includes(kind);
}

export function isHistoryKind(kind: FieldKind): boolean {
  return historyKindFor(kind) !== null || isSharedHistoryKind(kind);
}

export const SELF_ID_KINDS = [
  'gender',
  'pronouns',
  'ethnicity',
  'race',
  'sexualOrientation',
  'transgender',
  'veteranStatus',
  'disabilityStatus',
] as const satisfies ReadonlyArray<FieldKind>;

export type SelfIdKind = (typeof SELF_ID_KINDS)[number];

export function isSelfIdKind(kind: string): kind is SelfIdKind {
  return (SELF_ID_KINDS as ReadonlyArray<string>).includes(kind);
}

export type DetectedField = {
  el: HTMLElement;
  kind: FieldKind;
  label: string;
  confidence: number;
  widget?:
    | 'native'
    | 'virtualizedDropdown'
    | 'buttonGroup'
    | 'locateButton'
    | 'shadowCombobox'
    | 'monthYearPicker';
  group?: FieldGroup;
  datePart?: 'month' | 'year';
};

export type UnclassifiedFieldType = 'text' | 'textarea' | 'radio' | 'select' | 'combobox' | 'checkbox' | 'buttongroup';

export type UnclassifiedField = {
  el: HTMLElement;
  label: string;
  fieldType: UnclassifiedFieldType;
  options?: string[];
  widget?: 'shadowCombobox';
};

export type DetectionResult = {
  classified: DetectedField[];
  unclassified: UnclassifiedField[];
};

export type SiteAnswer = {
  field: DetectedField;
  answer: (options: string[]) => string | boolean | null;
};

export type HistoryEntrySummary = { title: string; detail: string };

export interface HistoryEditor {
  readonly newEntryFirst: boolean;
  entries(root: Document, kind: HistoryGroupKind): HTMLElement[];
  openForm(root: Document, kind: HistoryGroupKind): HTMLElement | null;
  addButton(root: Document, kind: HistoryGroupKind): HTMLElement | null;
  removeButton(entry: HTMLElement): HTMLElement | null;
  confirmRemoveButton(root: Document): HTMLElement | null;
  saveButton(form: HTMLElement): HTMLElement | null;
  formFields(form: HTMLElement, group: FieldGroup): DetectedField[];
  summary(entry: HTMLElement): HistoryEntrySummary;
}

export interface PlatformAdapter {
  readonly id: AdapterId;
  readonly name: string;
  matches(url: URL, document: Document): boolean;
  detectFields(root: Document): DetectedField[];
  detectAll?(root: Document): DetectionResult;
  historyEditor?: HistoryEditor;
  fillResume?(file: File, root: Document): Promise<boolean>;
  resumeAttached?(root: Document): boolean;
  siteAnswers?(root: Document): SiteAnswer[];
  getJobDescription(doc: Document): string;
  detectSubmissionConfirmed?(doc: Document, url: URL): boolean;
}
