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
  | 'veteranStatus'
  | 'disabilityStatus'
  | 'coverLetter'
  | 'openEnded';

export type DetectedField = {
  el: HTMLElement;
  kind: FieldKind;
  label: string;
  confidence: number;
  widget?: 'native' | 'virtualizedDropdown';
};

export interface PlatformAdapter {
  readonly id: AdapterId;
  readonly name: string;
  matches(url: URL, document: Document): boolean;
  detectFields(root: Document): DetectedField[];
  fillResume?(file: File, root: Document): Promise<boolean>;
  getJobDescription(doc: Document): string;
  detectSubmissionConfirmed?(doc: Document, url: URL): boolean;
}
