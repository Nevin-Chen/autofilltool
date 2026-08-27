import type { AdapterId } from '@/profile/schema';

export type FieldKind =
  | 'firstName'
  | 'lastName'
  | 'fullName'
  | 'preferredName'
  | 'email'
  | 'phone'
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
  | 'coverLetter'
  | 'openEnded';

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
  widget?: 'native' | 'virtualizedDropdown' | 'buttonGroup';
};

export type UnclassifiedFieldType = 'text' | 'textarea' | 'radio' | 'select' | 'combobox' | 'checkbox' | 'buttongroup';

export type UnclassifiedField = {
  el: HTMLElement;
  label: string;
  fieldType: UnclassifiedFieldType;
  options?: string[];
};

export type DetectionResult = {
  classified: DetectedField[];
  unclassified: UnclassifiedField[];
};

export interface PlatformAdapter {
  readonly id: AdapterId;
  readonly name: string;
  matches(url: URL, document: Document): boolean;
  detectFields(root: Document): DetectedField[];
  detectAll?(root: Document): DetectionResult;
  fillResume?(file: File, root: Document): Promise<boolean>;
  getJobDescription(doc: Document): string;
  detectSubmissionConfirmed?(doc: Document, url: URL): boolean;
}
