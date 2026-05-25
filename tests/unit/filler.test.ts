import { describe, expect, it, beforeEach } from 'vitest';
import { fillField, pickSelectOption, looksLikeSubmit } from '@/content/filler';
import type { DetectedField } from '@/adapters/types';

function mkField(el: HTMLElement, partial: Partial<DetectedField> = {}): DetectedField {
  return {
    el,
    kind: 'firstName',
    label: 'First name',
    confidence: 1,
    ...partial,
  };
}

describe('fillField — text inputs', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('writes via the native setter so React-style trackers see it', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);

    // Spy the prototype setter — same trick React uses internally.
    let observed: string | null = null;
    const proto = HTMLInputElement.prototype;
    const orig = Object.getOwnPropertyDescriptor(proto, 'value');
    if (!orig?.set) throw new Error('value setter missing');
    const origGet = orig.get;
    const origSet = orig.set;
    Object.defineProperty(proto, 'value', {
      configurable: true,
      get(): unknown {
        return origGet ? origGet.call(this) : undefined;
      },
      set(v: string): void {
        observed = v;
        origSet.call(this, v);
      },
    });

    const action = fillField(mkField(input), 'Ada', { forceOverwrite: false });

    // Restore the original setter regardless of outcome.
    Object.defineProperty(proto, 'value', orig);

    expect(action.status).toBe('filled');
    expect(observed).toBe('Ada');
    expect(input.value).toBe('Ada');
  });

  it('dispatches input + change + blur events in order', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    const events: string[] = [];
    for (const t of ['input', 'change', 'blur'] as const) {
      input.addEventListener(t, () => events.push(t));
    }
    fillField(mkField(input), 'Hello', { forceOverwrite: false });
    expect(events).toEqual(['input', 'change', 'blur']);
  });

  it('skips a field that already has a value', () => {
    const input = document.createElement('input');
    input.value = 'already there';
    document.body.appendChild(input);
    const action = fillField(mkField(input), 'new', { forceOverwrite: false });
    expect(action.status).toBe('skipped');
    expect(action.note).toMatch(/already filled/);
    expect(input.value).toBe('already there');
  });

  it('overwrites when forceOverwrite is true', () => {
    const input = document.createElement('input');
    input.value = 'old';
    document.body.appendChild(input);
    const action = fillField(mkField(input), 'new', { forceOverwrite: true });
    expect(action.status).toBe('filled');
    expect(input.value).toBe('new');
  });

  it('skips when no value is provided', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    const action = fillField(mkField(input), '', { forceOverwrite: false });
    expect(action.status).toBe('skipped');
    expect(action.note).toMatch(/no value/);
  });

  it('handles textareas', () => {
    const ta = document.createElement('textarea');
    document.body.appendChild(ta);
    const action = fillField(mkField(ta, { kind: 'coverLetter' }), 'Dear ...', {
      forceOverwrite: false,
    });
    expect(action.status).toBe('filled');
    expect(ta.value).toBe('Dear ...');
  });
});

describe('fillField — select', () => {
  it('matches by value first', () => {
    const sel = document.createElement('select');
    sel.innerHTML = `
      <option value="">--</option>
      <option value="US">United States</option>
      <option value="CA">Canada</option>
    `;
    document.body.appendChild(sel);
    const a = fillField(mkField(sel, { kind: 'country' }), 'US', { forceOverwrite: false });
    expect(a.status).toBe('filled');
    expect(sel.value).toBe('US');
  });

  it('falls back to visible text, case-insensitive', () => {
    const sel = document.createElement('select');
    sel.innerHTML = `
      <option value="">-- Select --</option>
      <option value="us">United States</option>
      <option value="ca">Canada</option>
    `;
    document.body.appendChild(sel);
    const a = fillField(mkField(sel, { kind: 'country' }), 'canada', {
      forceOverwrite: false,
    });
    expect(a.status).toBe('filled');
    expect(sel.value).toBe('ca');
  });

  it('returns an error when no option matches', () => {
    const sel = document.createElement('select');
    sel.innerHTML = `
      <option value="">-- Select --</option>
      <option value="a">A</option>
      <option value="b">B</option>
    `;
    document.body.appendChild(sel);
    const a = fillField(mkField(sel, { kind: 'country' }), 'Z', {
      forceOverwrite: false,
    });
    expect(a.status).toBe('error');
  });
});

describe('fillField — checkbox & radio', () => {
  it('clicks a checkbox only when state differs', () => {
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    document.body.appendChild(cb);

    const a = fillField(mkField(cb, { kind: 'willingToRelocate' }), true, {
      forceOverwrite: false,
    });
    expect(a.status).toBe('filled');
    expect(cb.checked).toBe(true);

    const b = fillField(mkField(cb, { kind: 'willingToRelocate' }), true, {
      forceOverwrite: false,
    });
    expect(b.status).toBe('skipped');
  });

  it('picks the matching radio in a group, supports yes/no synonyms', () => {
    document.body.innerHTML = `
      <input type="radio" name="auth" id="r-yes" value="yes" />
      <label for="r-yes">Yes</label>
      <input type="radio" name="auth" id="r-no" value="no" />
      <label for="r-no">No</label>
    `;
    const yes = document.getElementById('r-yes') as HTMLInputElement;
    const no = document.getElementById('r-no') as HTMLInputElement;
    const a = fillField(mkField(yes, { kind: 'authorizedToWorkInUS' }), true, {
      forceOverwrite: false,
    });
    expect(a.status).toBe('filled');
    expect(yes.checked).toBe(true);
    expect(no.checked).toBe(false);
  });
});

describe('safety — submit denylist', () => {
  it('looksLikeSubmit catches common submit copy', () => {
    const a = document.createElement('button');
    a.textContent = 'Submit application';
    expect(looksLikeSubmit(a)).toBe(true);

    const b = document.createElement('button');
    b.textContent = 'Apply now';
    expect(looksLikeSubmit(b)).toBe(true);

    const c = document.createElement('button');
    c.textContent = 'Next';
    expect(looksLikeSubmit(c)).toBe(false);
  });

  it('does not click a checkbox labelled like a submit', () => {
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.setAttribute('aria-label', 'Submit application');
    document.body.appendChild(cb);
    const a = fillField(mkField(cb, { kind: 'willingToRelocate' }), true, {
      forceOverwrite: false,
    });
    expect(a.status).toBe('error');
    expect(cb.checked).toBe(false);
  });
});

describe('pickSelectOption', () => {
  it('prefers exact value over partial label', () => {
    const sel = document.createElement('select');
    sel.innerHTML = `
      <option value="US">United States</option>
      <option value="USA">USA (legacy)</option>
    `;
    expect(pickSelectOption(sel, 'US')).toBe('US');
  });

  it('returns null when nothing matches', () => {
    const sel = document.createElement('select');
    sel.innerHTML = `<option value="x">X</option>`;
    expect(pickSelectOption(sel, 'Z')).toBeNull();
  });
});
