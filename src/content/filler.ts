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

export type AttachOptions = {
  forceOverwrite: boolean;
};

export type AttachAction = {
  status: 'attached' | 'skipped' | 'error';
  note?: string;
};

/**
 * Attach a File to an <input type="file">. The trick: file inputs can't be
 * set via .value (it would be a security hole) — you build a DataTransfer,
 * assign its files property, then dispatch `change` so the host page's
 * listeners run.
 *
 * Skips when the input already has a file, unless forceOverwrite is true.
 */
export function attachFile(
  input: HTMLInputElement,
  file: File,
  opts: AttachOptions,
): AttachAction {
  if (input.type !== 'file') {
    return { status: 'error', note: 'not a file input' };
  }
  if (input.disabled) {
    return { status: 'skipped', note: 'input is disabled' };
  }
  if (!opts.forceOverwrite && input.files && input.files.length > 0) {
    return { status: 'skipped', note: 'already has a file' };
  }
  try {
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return { status: 'attached' };
  } catch (err) {
    return {
      status: 'error',
      note: err instanceof Error ? err.message : String(err),
    };
  }
}

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

/* ------------------------------------------------------- virtualised dropdowns */

/**
 * Workday and similar ATSes don't use native `<select>` — instead they
 * render a `<button role="combobox">` trigger that opens a portal-mounted
 * `<ul role="listbox">` with `<li role="option">` children when clicked.
 * The select happens by clicking the matching option, which the React
 * controller picks up via its own listener.
 *
 * Flow:
 *   1. Click the trigger.
 *   2. Wait for a `[role="listbox"]` to appear anywhere in the document.
 *      Use a MutationObserver — the popup is usually portal-rendered as a
 *      sibling of `<body>`, not under the trigger.
 *   3. Find an option whose text content contains the desired value
 *      (case-insensitive substring). If none, abandon and click the
 *      trigger again to close the popup.
 *   4. Click the matching option. Fire a change event on the trigger for
 *      good measure — some Workday widgets listen on that.
 *
 * The wait is bounded: a default 1500ms is enough for React to mount the
 * popup but short enough that a failed open doesn't stall the whole fill.
 */
export type VirtualizedDropdownOptions = {
  /** Maximum ms to wait for the listbox popup to appear. Default 1500. */
  timeoutMs?: number;
  /**
   * Document the search should look in. Defaults to the trigger's
   * ownerDocument; tests can pass a custom root.
   */
  root?: Document;
};

export async function fillVirtualizedDropdown(
  field: DetectedField,
  rawValue: string | boolean | null | undefined,
  opts: VirtualizedDropdownOptions = {},
): Promise<FillAction> {
  const { el, kind, label } = field;
  const trigger = el;
  if (rawValue === null || rawValue === undefined || rawValue === '') {
    return { label, kind, status: 'skipped', note: 'no value in profile' };
  }
  const want = String(rawValue).trim();
  if (!want) {
    return { label, kind, status: 'skipped', note: 'no value in profile' };
  }
  if (!(trigger instanceof HTMLElement)) {
    return { label, kind, status: 'unsupported', note: 'trigger is not an HTMLElement' };
  }

  const root: Document = opts.root ?? trigger.ownerDocument;
  const timeout = opts.timeoutMs ?? 1500;

  try {
    trigger.click();
  } catch (err) {
    return {
      label,
      kind,
      status: 'error',
      note: err instanceof Error ? err.message : String(err),
    };
  }

  // If a listbox is already in the DOM (some Workday widgets keep it
  // mounted and just toggle visibility), `waitForListbox` returns
  // synchronously.
  const listbox = await waitForListbox(root, timeout);
  if (!listbox) {
    return { label, kind, status: 'skipped', note: 'dropdown popup did not appear' };
  }

  const option = pickListboxOption(listbox, want);
  if (!option) {
    // Close the popup by clicking the trigger again so the page is left
    // in the same state the user found it in.
    try {
      trigger.click();
    } catch {
      /* ignore */
    }
    return {
      label,
      kind,
      status: 'skipped',
      note: `no option matched "${truncate(want, 60)}"`,
    };
  }

  option.click();
  trigger.dispatchEvent(new Event('change', { bubbles: true }));
  return { label, kind, status: 'filled', note: `selected "${textOfNode(option)}"` };
}

/**
 * Find a `[role="option"]` whose text contains `want` (case-insensitive).
 * Prefers an exact match over a substring match so "United States" beats
 * "United States of America" when the profile says "United States".
 */
export function pickListboxOption(
  listbox: Element,
  want: string,
): HTMLElement | null {
  const wantLower = want.toLowerCase().trim();
  if (!wantLower) return null;
  const options = Array.from(
    listbox.querySelectorAll<HTMLElement>('[role="option"]'),
  ).filter((el) => !isDisabled(el));
  let exact: HTMLElement | null = null;
  let substr: HTMLElement | null = null;
  for (const opt of options) {
    const text = textOfNode(opt).toLowerCase();
    if (text === wantLower) {
      exact = opt;
      break;
    }
    if (!substr && text.includes(wantLower)) substr = opt;
  }
  return exact ?? substr;
}

/**
 * Resolve to the first `[role="listbox"]` to appear in the document
 * (including any that's already mounted at call time). Resolves to null
 * after `timeoutMs` with nothing found.
 */
function waitForListbox(root: Document, timeoutMs: number): Promise<Element | null> {
  const existing = root.querySelector('[role="listbox"]');
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: Element | null) => {
      if (done) return;
      done = true;
      observer.disconnect();
      clearTimeout(timer);
      resolve(v);
    };
    const observer = new MutationObserver(() => {
      const found = root.querySelector('[role="listbox"]');
      if (found) finish(found);
    });
    observer.observe(root.documentElement, { childList: true, subtree: true });
    const timer = setTimeout(() => finish(null), timeoutMs);
  });
}

function isDisabled(el: HTMLElement): boolean {
  return (
    el.getAttribute('aria-disabled') === 'true' ||
    el.hasAttribute('disabled')
  );
}

function textOfNode(el: Element): string {
  return (el.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}
