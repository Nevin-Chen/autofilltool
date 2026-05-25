/**
 * The only place in the codebase that mutates form elements. All adapters
 * route through here so the safety rules are enforced uniformly:
 *
 *   - Never overwrite a non-empty field unless `forceOverwrite` is true.
 *   - Always use the native value setter so framework state trackers update.
 *   - Dispatch `input`, `change`, `blur` in order.
 *   - For <select>, match by value, then by visible text (case-insensitive).
 *   - For checkboxes/radios, only `click()` if the target state differs from
 *     the current state.
 *   - Refuse to click anything that looks like a submit button.
 */

import { setNativeValue, dispatchInputEvents } from '@/lib/events';
import type { DetectedField } from '@/adapters/types';

/** Buttons/inputs we will never click as part of fill or radio selection. */
const SUBMIT_DENY = /\b(submit|apply now|send application|continue to submit)\b/i;

export type FillAction = {
  label: string;
  kind: string;
  status: 'filled' | 'skipped' | 'unsupported' | 'error';
  note?: string;
};

export type FillOptions = {
  forceOverwrite: boolean;
};

/**
 * Try to set a single field. Returns the action record so callers can build
 * an action log.
 */
export function fillField(
  field: DetectedField,
  rawValue: string | boolean | null | undefined,
  opts: FillOptions,
): FillAction {
  const { el, kind, label } = field;
  if (rawValue === null || rawValue === undefined || rawValue === '') {
    return { label, kind, status: 'skipped', note: 'no value in profile' };
  }

  try {
    if (el instanceof HTMLInputElement) {
      if (el.type === 'checkbox') {
        return fillCheckbox(el, rawValue, opts, { label, kind });
      }
      if (el.type === 'radio') {
        return fillRadio(el, rawValue, opts, { label, kind });
      }
      return fillTextInput(el, String(rawValue), opts, { label, kind });
    }
    if (el instanceof HTMLTextAreaElement) {
      return fillTextInput(el, String(rawValue), opts, { label, kind });
    }
    if (el instanceof HTMLSelectElement) {
      return fillSelect(el, String(rawValue), opts, { label, kind });
    }
    return { label, kind, status: 'unsupported', note: 'unknown element type' };
  } catch (err) {
    return {
      label,
      kind,
      status: 'error',
      note: err instanceof Error ? err.message : String(err),
    };
  }
}

/* --------------------------------------------------------- per element type */

type Meta = { label: string; kind: string };

function fillTextInput(
  el: HTMLInputElement | HTMLTextAreaElement,
  value: string,
  opts: FillOptions,
  meta: Meta,
): FillAction {
  if (!opts.forceOverwrite && el.value && el.value.trim() !== '') {
    return { ...meta, status: 'skipped', note: 'already filled' };
  }
  setNativeValue(el, value);
  dispatchInputEvents(el);
  return { ...meta, status: 'filled' };
}

function fillSelect(
  el: HTMLSelectElement,
  value: string,
  opts: FillOptions,
  meta: Meta,
): FillAction {
  if (!opts.forceOverwrite && el.value && el.value !== '') {
    return { ...meta, status: 'skipped', note: 'already filled' };
  }
  const target = pickSelectOption(el, value);
  if (target === null) {
    return {
      ...meta,
      status: 'error',
      note: `no <option> matched "${value}"`,
    };
  }
  setNativeValue(el, target);
  dispatchInputEvents(el);
  return { ...meta, status: 'filled' };
}

/** Try value match first, then case-insensitive label match. */
export function pickSelectOption(el: HTMLSelectElement, want: string): string | null {
  const target = want.trim().toLowerCase();
  for (const opt of Array.from(el.options)) {
    if (opt.value === want) return opt.value;
  }
  for (const opt of Array.from(el.options)) {
    if ((opt.value ?? '').toLowerCase() === target) return opt.value;
  }
  for (const opt of Array.from(el.options)) {
    const text = (opt.textContent ?? '').trim().toLowerCase();
    if (text === target) return opt.value;
  }
  // Last-ditch: a label that *contains* the target. Conservative cutoff so
  // we don't match "United States" when the user typed "ate".
  if (target.length >= 3) {
    for (const opt of Array.from(el.options)) {
      const text = (opt.textContent ?? '').trim().toLowerCase();
      if (text.includes(target)) return opt.value;
    }
  }
  return null;
}

function fillCheckbox(
  el: HTMLInputElement,
  rawValue: string | boolean,
  opts: FillOptions,
  meta: Meta,
): FillAction {
  const want = coerceBool(rawValue);
  if (want === null) {
    return { ...meta, status: 'skipped', note: `non-boolean value (${String(rawValue)})` };
  }
  if (!opts.forceOverwrite && el.checked === want) {
    return { ...meta, status: 'skipped', note: 'already in desired state' };
  }
  if (looksLikeSubmit(el)) {
    return { ...meta, status: 'error', note: 'refused: looks like a submit control' };
  }
  // Use click() rather than mutating .checked so frameworks notice and any
  // associated logic (e.g., revealing follow-up fields) runs.
  el.click();
  return { ...meta, status: 'filled' };
}

function fillRadio(
  el: HTMLInputElement,
  rawValue: string | boolean,
  opts: FillOptions,
  meta: Meta,
): FillAction {
  const want = String(rawValue).trim().toLowerCase();
  // Find sibling radios in the same group.
  const root = el.form ?? el.ownerDocument;
  const name = el.name;
  if (!name) {
    return { ...meta, status: 'error', note: 'radio has no name attribute' };
  }
  const group = Array.from(
    root.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${cssEscape(name)}"]`),
  );

  const target = group.find((r) => {
    if (looksLikeSubmit(r)) return false;
    const candidates = [
      r.value,
      r.getAttribute('aria-label') ?? '',
      labelTextFor(r),
    ].map((s) => s.trim().toLowerCase());
    // Allow yes/no/true/false interchange.
    const synonyms: Record<string, string[]> = {
      yes: ['yes', 'true', 'y'],
      no: ['no', 'false', 'n'],
      true: ['yes', 'true', 'y'],
      false: ['no', 'false', 'n'],
    };
    const targets = synonyms[want] ?? [want];
    return candidates.some((c) => targets.includes(c));
  });

  if (!target) {
    return { ...meta, status: 'error', note: `no radio matched "${want}"` };
  }
  if (target.checked && !opts.forceOverwrite) {
    return { ...meta, status: 'skipped', note: 'already in desired state' };
  }
  target.click();
  return { ...meta, status: 'filled' };
}

/* ------------------------------------------------------- helpers */

function coerceBool(v: string | boolean | null | undefined): boolean | null {
  if (typeof v === 'boolean') return v;
  if (v === null || v === undefined) return null;
  const s = String(v).trim().toLowerCase();
  if (['true', 'yes', 'y', '1'].includes(s)) return true;
  if (['false', 'no', 'n', '0'].includes(s)) return false;
  return null;
}

export function looksLikeSubmit(el: HTMLElement): boolean {
  const text = (el.textContent ?? '').trim();
  const value = el instanceof HTMLInputElement ? el.value : '';
  const aria = el.getAttribute('aria-label') ?? '';
  return SUBMIT_DENY.test(text) || SUBMIT_DENY.test(value) || SUBMIT_DENY.test(aria);
}

function labelTextFor(el: HTMLInputElement): string {
  const id = el.id;
  if (id) {
    const lbl = el.ownerDocument.querySelector<HTMLLabelElement>(
      `label[for="${cssEscape(id)}"]`,
    );
    if (lbl) return (lbl.textContent ?? '').trim();
  }
  const wrap = el.closest('label');
  if (wrap) return (wrap.textContent ?? '').trim();
  return '';
}

function cssEscape(s: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(s);
  return s.replace(/(["\\#.:;,?!+*~'`()\[\]{}<>=|/])/g, '\\$1');
}
