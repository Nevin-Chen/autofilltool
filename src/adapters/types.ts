/**
 * The contract every platform adapter implements: pure detection + an optional
 * resume hook. Adapters never write storage, call AI, or hit the webhook.
 * To add an ATS: add a file here, export an adapter, register in ./registry.ts.
 */

import type { AdapterId } from '@/profile/schema';

/**
 * The semantic role of a form field; the filler maps a profile to a value per
 * `kind`. Unknown fields are just not returned by `detectFields`.
 */
export type FieldKind =
  // identity
  | 'firstName'
  | 'lastName'
  | 'fullName'
  | 'preferredName'
  | 'email'
  | 'phone'
  // address
  | 'addressLine1'
  | 'addressLine2'
  | 'city'
  | 'region'
  | 'postalCode'
  | 'country'
  // links
  | 'linkedin'
  | 'github'
  | 'portfolio'
  | 'twitter'
  | 'otherLink'
  // work auth
  | 'authorizedToWorkInUS'
  | 'requiresSponsorship'
  | 'willingToRelocate'
  | 'desiredSalary'
  // demographics (only filled if the user has explicitly set a value)
  | 'gender'
  | 'pronouns'
  | 'ethnicity'
  | 'veteranStatus'
  | 'disabilityStatus'
  // open-ended (textareas; handled separately — AI suggestions live here)
  | 'coverLetter'
  | 'openEnded';

export type DetectedField = {
  /** The element the filler should write to. */
  el: HTMLElement;
  /** What this field means semantically. */
  kind: FieldKind;
  /** Human-readable label, for the action log + AI prompts. */
  label: string;
  /** Confidence 0..1; the filler uses it to break ties between overlapping kinds. */
  confidence: number;
  /**
   * How the field is rendered. Default 'native' (real input/textarea/select,
   * sync `fillField` path). `'virtualizedDropdown'` = React combobox: a
   * `button[role=combobox]` opening a portal `ul[role=listbox]` of
   * `[role=option]`s; runFill awaits `fillVirtualizedDropdown` since the popup
   * appears async. Set by Workday-style pickers; generic leaves it unset.
   */
  widget?: 'native' | 'virtualizedDropdown';
};

export interface PlatformAdapter {
  /** Stable identifier; matches AdapterId in profile/schema.ts. */
  readonly id: AdapterId;
  /** Human label, surfaced in the popup. */
  readonly name: string;
  /** Cheap check. The detector calls this in registry order. */
  matches(url: URL, document: Document): boolean;
  /** Finds and classifies the form fields on this page. */
  detectFields(root: Document): DetectedField[];
  /**
   * Optional hook to attach the resume to a file input. True if uploaded,
   * false if no slot found. Falls back to a generic impl if omitted.
   */
  fillResume?(file: File, root: Document): Promise<boolean>;
  /**
   * Best-effort job-description text (the "About this role" body, NOT form
   * fields) as AI Suggest context. Return normalised text only — no HTML, nav,
   * or scripts — capped ~3000 chars; '' when nothing found, never throws.
   * Generic adapter uses `@mozilla/readability` as a last resort.
   */
  getJobDescription(doc: Document): string;
}
