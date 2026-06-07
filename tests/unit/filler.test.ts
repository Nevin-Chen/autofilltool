import { describe, expect, it, beforeEach } from 'vitest';
import {
  fillField,
  fillVirtualizedDropdown,
  pickListboxOption,
  pickSelectOption,
  looksLikeSubmit,
} from '@/content/filler';
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

  it('falls back to a word-boundary prefix match for verbose EEO radio labels', () => {
    document.body.innerHTML = `
      <input type="radio" name="race" id="race-0" />
      <label for="race-0">Hispanic or Latino</label>
      <input type="radio" name="race" id="race-1" />
      <label for="race-1">White (Not Hispanic or Latino)</label>
      <input type="radio" name="race" id="race-2" />
      <label for="race-2">Asian (Not Hispanic or Latino)</label>
      <input type="radio" name="race" id="race-3" />
      <label for="race-3">American Indian or Alaska Native (Not Hispanic or Latino)</label>
    `;
    const r0 = document.getElementById('race-0') as HTMLInputElement;
    const asian = document.getElementById('race-2') as HTMLInputElement;
    const a = fillField(mkField(r0, { kind: 'race' }), 'Asian', { forceOverwrite: false });
    expect(a.status).toBe('filled');
    expect(asian.checked).toBe(true);
  });

  it('prefix match resolves "No" against a verbose disability label', () => {
    document.body.innerHTML = `
      <input type="radio" name="dis" id="dis-0" />
      <label for="dis-0">Yes, I have a disability, or have had one in the past</label>
      <input type="radio" name="dis" id="dis-1" />
      <label for="dis-1">No, I don't have a disability and have not had one in the past</label>
      <input type="radio" name="dis" id="dis-2" />
      <label for="dis-2">I do not want to answer</label>
    `;
    const rep = document.getElementById('dis-0') as HTMLInputElement;
    const no = document.getElementById('dis-1') as HTMLInputElement;
    const a = fillField(mkField(rep, { kind: 'disabilityStatus' }), 'No', {
      forceOverwrite: false,
    });
    expect(a.status).toBe('filled');
    expect(no.checked).toBe(true);
  });

  it('resolves "No" against the live Ashby disability DOM (nested spans, sibling label)', () => {
    document.body.innerHTML = `
      <fieldset>
        <label for="_systemfield_eeoc_disability_status">Disability Status</label>
        <div class="_option_1258i_34 false">
          <span class="_container_132c8_28" data-disabled="false">
            <span class="_circle_132c8_77"></span>
            <input type="radio" id="dis-0" name="d39__systemfield_eeoc_disability_status" />
          </span>
          <label for="dis-0">Yes, I have a disability, or have had one in the past</label>
        </div>
        <div class="_option_1258i_34 false">
          <span class="_container_132c8_28" data-disabled="false">
            <span class="_circle_132c8_77"></span>
            <input type="radio" id="dis-1" name="d39__systemfield_eeoc_disability_status" />
          </span>
          <label for="dis-1">No, I don't have a disability and have not had one in the past</label>
        </div>
        <div class="_option_1258i_34 false">
          <span class="_container_132c8_28" data-disabled="false">
            <span class="_circle_132c8_77"></span>
            <input type="radio" id="dis-2" name="d39__systemfield_eeoc_disability_status" />
          </span>
          <label for="dis-2">I do not want to answer</label>
        </div>
      </fieldset>
    `;
    const rep = document.getElementById('dis-0') as HTMLInputElement;
    const no = document.getElementById('dis-1') as HTMLInputElement;
    const a = fillField(mkField(rep, { kind: 'disabilityStatus' }), 'No', {
      forceOverwrite: false,
    });
    expect(a.status).toBe('filled');
    expect(no.checked).toBe(true);
  });

  it('resolves "do not wish to answer" to a "I do not want to answer" disability option via synonym fallback', () => {
    document.body.innerHTML = `
      <input type="radio" name="dis" id="dis-0" />
      <label for="dis-0">Yes, I have a disability, or have had one in the past</label>
      <input type="radio" name="dis" id="dis-1" />
      <label for="dis-1">No, I don't have a disability and have not had one in the past</label>
      <input type="radio" name="dis" id="dis-2" />
      <label for="dis-2">I do not want to answer</label>
    `;
    const rep = document.getElementById('dis-0') as HTMLInputElement;
    const opt = document.getElementById('dis-2') as HTMLInputElement;
    const a = fillField(mkField(rep, { kind: 'disabilityStatus' }), 'do not wish to answer', {
      forceOverwrite: false,
    });
    expect(a.status).toBe('filled');
    expect(opt.checked).toBe(true);
  });

  it('resolves "decline" to a "Decline to self-identify" race option via synonym fallback', () => {
    document.body.innerHTML = `
      <input type="radio" name="race" id="race-0" />
      <label for="race-0">Hispanic or Latino</label>
      <input type="radio" name="race" id="race-1" />
      <label for="race-1">Asian (Not Hispanic or Latino)</label>
      <input type="radio" name="race" id="race-2" />
      <label for="race-2">Decline to self-identify</label>
    `;
    const rep = document.getElementById('race-0') as HTMLInputElement;
    const opt = document.getElementById('race-2') as HTMLInputElement;
    const a = fillField(mkField(rep, { kind: 'race' }), 'decline', { forceOverwrite: false });
    expect(a.status).toBe('filled');
    expect(opt.checked).toBe(true);
  });

  it('refuses to pick when a prefix is ambiguous across multiple radios', () => {
    document.body.innerHTML = `
      <input type="radio" name="x" id="x-0" />
      <label for="x-0">American Indian or Alaska Native</label>
      <input type="radio" name="x" id="x-1" />
      <label for="x-1">American Samoan</label>
    `;
    const rep = document.getElementById('x-0') as HTMLInputElement;
    const a = fillField(mkField(rep, { kind: 'race' }), 'American', { forceOverwrite: false });
    expect(a.status).toBe('error');
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

describe('pickListboxOption', () => {
  it('prefers an exact text match over a substring match', () => {
    const ul = document.createElement('ul');
    ul.setAttribute('role', 'listbox');
    ul.innerHTML = `
      <li role="option">United States of America</li>
      <li role="option">United States</li>
      <li role="option">Canada</li>
    `;
    const hit = pickListboxOption(ul, 'United States');
    expect(hit?.textContent).toBe('United States');
  });

  it('substring matches when no exact hit', () => {
    const ul = document.createElement('ul');
    ul.setAttribute('role', 'listbox');
    ul.innerHTML = `
      <li role="option">United States of America</li>
      <li role="option">Canada</li>
    `;
    const hit = pickListboxOption(ul, 'United States');
    expect(hit?.textContent).toBe('United States of America');
  });

  it('is case-insensitive', () => {
    const ul = document.createElement('ul');
    ul.setAttribute('role', 'listbox');
    ul.innerHTML = `<li role="option">CANADA</li>`;
    const hit = pickListboxOption(ul, 'canada');
    expect(hit?.textContent).toBe('CANADA');
  });

  it('skips aria-disabled options', () => {
    const ul = document.createElement('ul');
    ul.setAttribute('role', 'listbox');
    ul.innerHTML = `
      <li role="option" aria-disabled="true">United States</li>
      <li role="option">United States of America</li>
    `;
    const hit = pickListboxOption(ul, 'United States');
    expect(hit?.textContent).toBe('United States of America');
  });

  it('returns null when nothing matches', () => {
    const ul = document.createElement('ul');
    ul.setAttribute('role', 'listbox');
    ul.innerHTML = `<li role="option">Canada</li>`;
    expect(pickListboxOption(ul, 'France')).toBeNull();
  });
});

describe('fillVirtualizedDropdown', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  function mkComboboxField(): { field: DetectedField; trigger: HTMLButtonElement } {
    const trigger = document.createElement('button');
    trigger.setAttribute('role', 'combobox');
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.textContent = 'Select One';
    document.body.appendChild(trigger);
    const field: DetectedField = {
      el: trigger,
      kind: 'country',
      label: 'Country',
      confidence: 0.99,
      widget: 'virtualizedDropdown',
    };
    return { field, trigger };
  }

  it('clicks the trigger, finds the option, clicks it, dispatches change', async () => {
    const { field, trigger } = mkComboboxField();
    let triggerClicks = 0;
    trigger.addEventListener('click', () => triggerClicks++);

    const ul = document.createElement('ul');
    ul.setAttribute('role', 'listbox');
    ul.innerHTML = `
      <li role="option">Canada</li>
      <li role="option">United States</li>
    `;
    document.body.appendChild(ul);

    const optionClicks: string[] = [];
    ul.addEventListener('click', (e) => {
      if (e.target instanceof HTMLElement) {
        optionClicks.push(e.target.textContent ?? '');
      }
    });
    let changeFired = false;
    trigger.addEventListener('change', () => (changeFired = true));

    const action = await fillVirtualizedDropdown(field, 'United States');
    expect(action.status).toBe('filled');
    expect(triggerClicks).toBe(1);
    expect(optionClicks).toContain('United States');
    expect(changeFired).toBe(true);
  });

  it('returns skipped when no value is provided', async () => {
    const { field } = mkComboboxField();
    const action = await fillVirtualizedDropdown(field, '');
    expect(action.status).toBe('skipped');
    expect(action.note).toMatch(/no value/i);
  });

  it('returns skipped when no option matches', async () => {
    const { field, trigger } = mkComboboxField();
    const ul = document.createElement('ul');
    ul.setAttribute('role', 'listbox');
    ul.innerHTML = `<li role="option">Canada</li>`;
    document.body.appendChild(ul);

    let triggerClicks = 0;
    trigger.addEventListener('click', () => triggerClicks++);

    const action = await fillVirtualizedDropdown(field, 'France');
    expect(action.status).toBe('skipped');
    expect(action.note).toMatch(/no option matched/i);
    expect(triggerClicks).toBe(2);
  });

  it('returns skipped when the listbox never appears (timeout)', async () => {
    const { field } = mkComboboxField();
    const action = await fillVirtualizedDropdown(field, 'United States', {
      timeoutMs: 10,
    });
    expect(action.status).toBe('skipped');
    expect(action.note).toMatch(/dropdown popup did not appear/i);
  });

  it('handles react-select: input is trigger AND search, listbox via aria-controls, commits via Enter on the input', async () => {
    const wrapper = document.createElement('div');
    wrapper.className = 'select__input-container';
    const input = document.createElement('input');
    input.id = 'question_17768983004';
    input.type = 'text';
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-controls', 'react-select-question_17768983004-listbox');
    wrapper.appendChild(input);
    document.body.appendChild(wrapper);

    const portal = document.createElement('div');
    portal.id = 'react-select-question_17768983004-listbox';
    portal.setAttribute('role', 'listbox');
    document.body.appendChild(portal);

    input.addEventListener('input', () => {
      portal.innerHTML = '';
      if (input.value.toLowerCase() === 'no') {
        const opt = document.createElement('div');
        opt.setAttribute('role', 'option');
        opt.textContent = 'No';
        portal.appendChild(opt);
      }
    });

    let openedViaMousedown = false;
    input.addEventListener('mousedown', () => (openedViaMousedown = true));
    const keys: string[] = [];
    input.addEventListener('keydown', (e) => keys.push(e.key));

    const field: DetectedField = {
      el: input,
      kind: 'authorizedToWorkInUS',
      label: 'Authorized to work?',
      confidence: 1,
      widget: 'virtualizedDropdown',
    };

    const action = await fillVirtualizedDropdown(field, 'No');
    expect(action.status).toBe('filled');
    expect(openedViaMousedown).toBe(true);
    expect(keys).toContain('Enter');
    expect(action.note).toMatch(/Enter/);
  });

  it("does NOT skip a fresh react-select (placeholder present, no single-value)", async () => {
    const valueContainer = document.createElement('div');
    valueContainer.className = 'select__value-container';
    const placeholder = document.createElement('div');
    placeholder.className = 'select__placeholder';
    placeholder.textContent = 'Select an option that best describes you';
    const inputContainer = document.createElement('div');
    inputContainer.className = 'select__input-container';
    inputContainer.setAttribute('data-value', '');
    const input = document.createElement('input');
    input.setAttribute('role', 'combobox');
    input.type = 'text';
    inputContainer.appendChild(input);
    valueContainer.append(placeholder, inputContainer);
    document.body.appendChild(valueContainer);

    let triggerOpened = false;
    input.addEventListener('mousedown', () => (triggerOpened = true));

    const field: DetectedField = {
      el: input,
      kind: 'authorizedToWorkInUS',
      label: 'Authorized?',
      confidence: 1,
      widget: 'virtualizedDropdown',
    };

    const action = await fillVirtualizedDropdown(field, 'Yes', { timeoutMs: 30 });
    expect(triggerOpened).toBe(true);
    expect(action.note).not.toMatch(/already filled/);
  });

  it("skips re-fill when the combobox already has a value and forceOverwrite is false", async () => {
    const wrapper = document.createElement('div');
    const singleValue = document.createElement('div');
    singleValue.className = 'select__single-value';
    singleValue.textContent = 'Yes';
    const inputContainer = document.createElement('div');
    inputContainer.className = 'select__input-container';
    inputContainer.setAttribute('data-value', 'Yes');
    const input = document.createElement('input');
    input.setAttribute('role', 'combobox');
    input.type = 'text';
    inputContainer.appendChild(input);
    wrapper.append(singleValue, inputContainer);
    document.body.appendChild(wrapper);

    let triggerOpened = false;
    input.addEventListener('mousedown', () => (triggerOpened = true));

    const field: DetectedField = {
      el: input,
      kind: 'authorizedToWorkInUS',
      label: 'Authorized?',
      confidence: 1,
      widget: 'virtualizedDropdown',
    };

    const action = await fillVirtualizedDropdown(field, 'No');
    expect(action.status).toBe('skipped');
    expect(action.note).toMatch(/already filled/);
    expect(triggerOpened).toBe(false);
  });

  it("re-fills when forceOverwrite is true even if a value is present", async () => {
    const wrapper = document.createElement('div');
    const inputContainer = document.createElement('div');
    inputContainer.setAttribute('data-value', 'Yes');
    const input = document.createElement('input');
    input.setAttribute('role', 'combobox');
    input.type = 'text';
    inputContainer.appendChild(input);
    wrapper.appendChild(inputContainer);
    document.body.appendChild(wrapper);

    let triggerOpened = false;
    input.addEventListener('mousedown', () => (triggerOpened = true));

    const field: DetectedField = {
      el: input,
      kind: 'authorizedToWorkInUS',
      label: 'Authorized?',
      confidence: 1,
      widget: 'virtualizedDropdown',
    };

    const action = await fillVirtualizedDropdown(field, 'No', {
      forceOverwrite: true,
      timeoutMs: 30,
    });
    expect(triggerOpened).toBe(true);
    expect(action.note).not.toMatch(/already filled/);
  });

  it("presses Enter on the trigger as a fallback when no [role=option] surfaces after typing", async () => {
    const wrapper = document.createElement('div');
    const input = document.createElement('input');
    input.id = 'q_auth';
    input.type = 'text';
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-controls', 'q_auth-listbox');
    wrapper.appendChild(input);
    document.body.appendChild(wrapper);

    const portal = document.createElement('div');
    portal.id = 'q_auth-listbox';
    portal.setAttribute('role', 'listbox');
    document.body.appendChild(portal);

    const keys: string[] = [];
    input.addEventListener('keydown', (e) => keys.push(e.key));

    const field: DetectedField = {
      el: input,
      kind: 'authorizedToWorkInUS',
      label: 'Authorized?',
      confidence: 1,
      widget: 'virtualizedDropdown',
    };

    const action = await fillVirtualizedDropdown(field, 'Yes', { timeoutMs: 50 });
    expect(action.status).toBe('filled');
    expect(action.note).toMatch(/Enter/);
    expect(keys).toContain('Enter');
  });
});
