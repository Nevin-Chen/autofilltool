import { setNativeValue, dispatchInputEvents } from '@/lib/events';
import type { DetectedField } from '@/adapters/types';

const SUBMIT_DENY = /\b(submit|apply now|send application|continue to submit)\b/i;

export type AttachOptions = {
  forceOverwrite: boolean;
};

export type AttachAction = {
  status: 'attached' | 'skipped' | 'error';
  note?: string;
};

export function isFileAlreadyAttached(root: Document, file: File): boolean {
  if (anyInputHoldsFile(root, file)) return true;
  return filenameShownNearFileInput(root, file.name);
}

function anyInputHoldsFile(root: Document, file: File): boolean {
  const inputs = root.querySelectorAll<HTMLInputElement>('input[type="file"]');
  for (const input of Array.from(inputs)) {
    const files = input.files;
    if (!files || files.length === 0) continue;
    for (let i = 0; i < files.length; i++) {
      const f = files.item(i);
      if (f && f.name === file.name && f.size === file.size) return true;
    }
  }
  return false;
}

const FILENAME_SEARCH_DEPTH = 4;
const FILENAME_CONTAINER_MAX_CHARS = 200;
const FILENAME_JUMP_MIN = 50;
const FILENAME_JUMP_RATIO = 4;

function filenameShownNearFileInput(root: Document, filename: string): boolean {
  if (!filename) return false;
  const fullLower = filename.toLowerCase();
  const stemLower = filenameStem(filename).toLowerCase();
  const matches = (text: string): boolean => {
    const lower = text.toLowerCase();
    if (lower.includes(fullLower)) return true;
    return stemLower.length >= 3 && lower.includes(stemLower);
  };
  const inputs = root.querySelectorAll<HTMLInputElement>('input[type="file"]');
  for (const input of Array.from(inputs)) {
    let container: Element | null = input.parentElement;
    let prevLen = 0;
    for (let depth = 0; depth < FILENAME_SEARCH_DEPTH && container; depth++) {
      const text = (container.textContent ?? '').trim();
      const curLen = text.length;
      if (curLen > FILENAME_CONTAINER_MAX_CHARS) break;
      if (depth > 0 && curLen > Math.max(FILENAME_JUMP_MIN, prevLen * FILENAME_JUMP_RATIO)) break;
      if (curLen > 0 && matches(text)) return true;
      prevLen = curLen;
      container = container.parentElement;
    }
  }
  return false;
}

function filenameStem(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

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
  suppressFlash?: boolean;
};

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
  if (!opts.suppressFlash) flashFilled(el);
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
  if (!opts.suppressFlash) flashFilled(el);
  return { ...meta, status: 'filled' };
}

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
  el.click();
  if (!opts.suppressFlash) flashFilled(el);
  return { ...meta, status: 'filled' };
}

function fillRadio(
  el: HTMLInputElement,
  rawValue: string | boolean,
  opts: FillOptions,
  meta: Meta,
): FillAction {
  const want = String(rawValue).trim().toLowerCase();
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
  if (!opts.suppressFlash) flashFilled(target);
  return { ...meta, status: 'filled' };
}

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
  return s.replace(/(["\\#.:;,?!+*~'`()[\]{}<>=|/])/g, '\\$1');
}

const HIGHLIGHT_HOLD_MS = 1100;
const HIGHLIGHT_FADE_MS = 450;
const HIGHLIGHT_SHADOW =
  '0 0 0 2px rgba(56,189,248,0.9), 0 0 8px 2px rgba(56,189,248,0.45)';

function flashFilled(el: HTMLElement): void {
  try {
    const style = el.style;
    const prevBoxShadow = style.boxShadow;
    const prevTransition = style.transition;
    style.transition = `box-shadow ${HIGHLIGHT_FADE_MS}ms ease-out`;
    style.boxShadow = HIGHLIGHT_SHADOW;
    setTimeout(() => {
      try {
        style.boxShadow = prevBoxShadow;
        setTimeout(() => {
          try {
            style.transition = prevTransition;
          } catch {
          }
        }, HIGHLIGHT_FADE_MS);
      } catch {
      }
    }, HIGHLIGHT_HOLD_MS);
  } catch {
  }
}

export type VirtualizedDropdownOptions = {
  timeoutMs?: number;
  root?: Document;
  suppressFlash?: boolean;
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
    openCombobox(trigger);
  } catch (err) {
    return {
      label,
      kind,
      status: 'error',
      note: err instanceof Error ? err.message : String(err),
    };
  }

  const listbox = await waitForListbox(root, trigger, timeout);
  if (!listbox) {
    return { label, kind, status: 'skipped', note: 'dropdown popup did not appear' };
  }

  if (trigger instanceof HTMLInputElement && !trigger.disabled && !trigger.readOnly) {
    setNativeValue(trigger, want);
    dispatchInputEvents(trigger);
    const filteredOption = await waitForOption(listbox, want, FILTERED_OPTION_TIMEOUT_MS);
    if (!filteredOption) {
      return { label, kind, status: 'skipped', note: `no option matched "${truncate(want, 60)}"` };
    }
    selectOption(filteredOption);
    trigger.dispatchEvent(new Event('change', { bubbles: true }));
    if (!opts.suppressFlash) flashFilled(trigger);
    return { label, kind, status: 'filled', note: `selected "${textOfNode(filteredOption)}"` };
  }

  const option = pickListboxOption(listbox, want);
  if (!option) {
    try {
      trigger.click();
    } catch {
    }
    return {
      label,
      kind,
      status: 'skipped',
      note: `no option matched "${truncate(want, 60)}"`,
    };
  }

  selectOption(option);
  trigger.dispatchEvent(new Event('change', { bubbles: true }));
  if (!opts.suppressFlash) flashFilled(trigger);
  return { label, kind, status: 'filled', note: `selected "${textOfNode(option)}"` };
}

const FILTERED_OPTION_TIMEOUT_MS = 400;

function openCombobox(trigger: HTMLElement): void {
  try {
    trigger.focus();
  } catch {
  }
  dispatchMouse(trigger, 'mousedown');
  dispatchMouse(trigger, 'mouseup');
  try {
    trigger.click();
  } catch {
  }
}

function selectOption(option: HTMLElement): void {
  dispatchMouse(option, 'mousedown');
  dispatchMouse(option, 'mouseup');
  try {
    option.click();
  } catch {
  }
}

function dispatchMouse(el: HTMLElement, type: 'mousedown' | 'mouseup'): void {
  try {
    el.dispatchEvent(
      new MouseEvent(type, { bubbles: true, cancelable: true, button: 0 }),
    );
  } catch {
  }
}

function waitForOption(
  listbox: Element,
  want: string,
  timeoutMs: number,
): Promise<HTMLElement | null> {
  const immediate = pickListboxOption(listbox, want);
  if (immediate) return Promise.resolve(immediate);
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: HTMLElement | null) => {
      if (done) return;
      done = true;
      observer.disconnect();
      clearTimeout(timer);
      resolve(v);
    };
    const observer = new MutationObserver(() => {
      const hit = pickListboxOption(listbox, want);
      if (hit) finish(hit);
    });
    observer.observe(listbox, { childList: true, subtree: true, characterData: true });
    const timer = setTimeout(() => finish(null), timeoutMs);
  });
}

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

function waitForListbox(
  root: Document,
  trigger: HTMLElement,
  timeoutMs: number,
): Promise<Element | null> {
  const ownedId =
    trigger.getAttribute('aria-controls') ?? trigger.getAttribute('aria-owns');
  const findByOwned = (): Element | null =>
    ownedId ? root.getElementById(ownedId) : null;
  const findFallback = (): Element | null =>
    root.querySelector('[role="listbox"]');
  const find = (): Element | null => findByOwned() ?? findFallback();

  const existing = find();
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
      const found = find();
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
