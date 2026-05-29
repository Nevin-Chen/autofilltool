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
  /**
   * How the field is rendered. Defaults to 'native' (a real <input>,
   * <textarea>, or <select> handled by the sync `fillField` path).
   *
   * `'virtualizedDropdown'` signals a React-style combobox: a
   * `<button role="combobox">` trigger that opens a portal-mounted
   * `<ul role="listbox">` with `[role="option"]` entries. The runFill
   * loop awaits `fillVirtualizedDropdown` for these because the popup
   * appears asynchronously after the click.
   *
   * Per-platform adapters set this on Workday country/state pickers and
   * similar widgets; the generic adapter leaves it unset.
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
   * Optional hook to attach the user's resume to a file input. Returns true
   * if it actually uploaded; false if no slot was found. Defaults to a
   * generic implementation if omitted.
   */
  fillResume?(file: File, root: Document): Promise<boolean>;
  /**
   * Best-effort extraction of the human-readable job description (the
   * "About this role" / "What you'll do" body text — NOT the form fields).
   * Used as prompt context for the AI Suggest feature so the model can
   * write answers that actually match what the company asked for.
   *
   * Adapters should:
   *   - Return the readable description text only, with whitespace
   *     normalised. No HTML tags, no nav/footer, no script blobs.
   *   - Cap output at ~3000 chars to keep prompt budgets sane. The prompt
   *     builder will truncate again defensively.
   *   - Return '' when nothing useful is found — never throw.
   *
   * The generic adapter uses `@mozilla/readability` as a last resort.
   */
  getJobDescription(doc: Document): string;
}
