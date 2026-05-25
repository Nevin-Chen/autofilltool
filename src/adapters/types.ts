/**
 * The contract every platform adapter implements. Adapters are pure
 * detection + an optional resume-upload hook. They never write to storage,
 * call the AI, or hit the webhook — those go through the background worker.
 *
 * To add a new ATS: create a file in this directory, export an adapter,
 * register it in ./registry.ts.
 */

import type { AdapterId } from '@/profile/schema';

/**
 * The semantic role of a form field. The filler maps a profile to a value
 * per `kind`. Unknown / unsupported fields are simply not returned by
 * `detectFields` — the filler ignores anything it can't classify.
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
  /**
   * How sure the adapter is, 0..1. The filler uses this to break ties when
   * two adapters/heuristics return overlapping kinds for the same element.
   */
  confidence: number;
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
   * Optional hook to attach the user's resume to a file input. Returns true
   * if it actually uploaded; false if no slot was found. Defaults to a
   * generic implementation if omitted.
   */
  fillResume?(file: File, root: Document): Promise<boolean>;
}
