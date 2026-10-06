import { describe, expect, it } from 'vitest';
import {
  fillField,
  fillSiteAnswer,
  fillMonthYearPicker,
  fillShadowCombobox,
  harvestShadowComboboxOptions,
} from '@/content/filler';
import type { DetectedField, FieldKind } from '@/adapters/types';

type Choice = { text: string; value: string };

type AutocompleteSpec = {
  options?: string[];
  search?: (query: string) => string[];
  customValues?: boolean;
  manualEntry?: boolean;
};

function mountAutocomplete(spec: AutocompleteSpec): {
  host: HTMLElement;
  input: HTMLInputElement;
  committed: () => string | null;
} {
  document.body.innerHTML = '';
  const host = document.createElement('spl-autocomplete');
  host.setAttribute('minquerylength', spec.search ? '3' : '0');
  const shadow = host.attachShadow({ mode: 'open' });
  const field = document.createElement('spl-input');
  const input = document.createElement('input');
  input.setAttribute('role', 'combobox');
  field.attachShadow({ mode: 'open' }).appendChild(input);
  const listbox = document.createElement('div');
  listbox.setAttribute('role', 'listbox');
  shadow.append(field, listbox);
  document.body.appendChild(host);

  let committed: string | null = null;
  const render = (choices: Choice[]) => {
    listbox.replaceChildren(
      ...choices.map(({ text, value }) => {
        const option = document.createElement('spl-select-option');
        option.setAttribute('value', value);
        option.textContent = text;
        const item = document.createElement('spl-dropdown-item');
        option.attachShadow({ mode: 'open' }).appendChild(item);
        const row = document.createElement('div');
        row.setAttribute('role', 'option');
        row.appendChild(document.createElement('slot'));
        item.attachShadow({ mode: 'open' }).appendChild(row);
        row.addEventListener('click', () => {
          committed = text;
          host.setAttribute('value', text);
          input.value = text;
          listbox.replaceChildren();
        });
        return option;
      }),
    );
  };

  field.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Escape') render([]);
  });

  const { options, search } = spec;
  if (options) {
    const showMatching = () => {
      const query = input.value.trim().toLowerCase();
      render(
        options
          .filter((o) => o.toLowerCase().includes(query))
          .map((text) => ({ text, value: text })),
      );
    };
    input.addEventListener('click', showMatching);
    field.addEventListener('input', showMatching);
  }
  if (search) {
    field.addEventListener('input', () => {
      const query = input.value.trim();
      if (!query) return render([]);
      const found: Choice[] = search(query).map((text) => ({ text, value: text }));
      if (spec.customValues && !found.some((c) => c.text === query)) {
        found.push({ text: query, value: '#spl-custom-option' });
      }
      if (spec.manualEntry) {
        found.push({
          text: 'Cannot find your city? Click here to fill in manually',
          value: 'goToManualLocationMode',
        });
      }
      render(found);
    });
  }
  return { host, input, committed: () => committed };
}

function fieldFor(el: HTMLElement, kind: FieldKind): DetectedField {
  return { el, kind, label: kind, confidence: 0.9, widget: 'shadowCombobox' };
}

const GENDER = [
  'Female or woman',
  'Male or man',
  'Non-binary (not female/woman or male/man)',
  'Other - A gender not listed above',
  'Unknown/I choose not to disclose',
];

const HISPANIC = [
  'Yes, I am Hispanic or Latino',
  'I am not Hispanic or Latino',
  'I choose not to disclose',
];

const VETERAN = [
  'I am a protected veteran',
  'I am a protected veteran, but I choose not to self-identify the classification to which I belong',
  'I have read the definition of protected veteran. I am a veteran but not a protected veteran',
  'I am NOT a veteran',
];

describe('shadow combobox with a fixed option list', () => {
  it('matches a saved answer to the form\'s own wording', async () => {
    const { host, committed } = mountAutocomplete({ options: GENDER });
    const action = await fillShadowCombobox(fieldFor(host, 'gender'), 'Male', {});
    expect(action.status).toBe('filled');
    expect(committed()).toBe('Male or man');
  });

  it('maps "Decline to self-identify" onto a "choose not to disclose" option', async () => {
    const { host, committed } = mountAutocomplete({ options: GENDER });
    await fillShadowCombobox(fieldFor(host, 'gender'), 'Decline to self-identify', {});
    expect(committed()).toBe('Unknown/I choose not to disclose');
  });

  it('answers "No" with the negative option, not the decline one that also says "not"', async () => {
    const { host, committed } = mountAutocomplete({ options: HISPANIC });
    await fillShadowCombobox(fieldFor(host, 'ethnicity'), 'No', {});
    expect(committed()).toBe('I am not Hispanic or Latino');
  });

  it('answers "Yes" with the affirmative option', async () => {
    const { host, committed } = mountAutocomplete({ options: HISPANIC });
    await fillShadowCombobox(fieldFor(host, 'ethnicity'), 'Yes', {});
    expect(committed()).toBe('Yes, I am Hispanic or Latino');
  });

  it('reads "not a protected veteran" as not a veteran when the form asks both ways', async () => {
    const { host, committed } = mountAutocomplete({ options: VETERAN });
    const action = await fillShadowCombobox(
      fieldFor(host, 'veteranStatus'),
      'I am not a protected veteran',
      {},
    );
    expect(action.status).toBe('filled');
    expect(committed()).toBe('I am NOT a veteran');
  });

  it('closes the list and clears the box when nothing matches', async () => {
    const { host, input, committed } = mountAutocomplete({ options: VETERAN });
    const action = await fillShadowCombobox(
      fieldFor(host, 'veteranStatus'),
      'I identify as a recently separated veteran',
      {},
    );
    expect(action.status).toBe('skipped');
    expect(action.note).toMatch(/no option matched/);
    expect(committed()).toBeNull();
    expect(input.value).toBe('');
    expect(host.shadowRoot!.querySelectorAll('spl-select-option')).toHaveLength(0);
  });

  it('keeps a value the user already picked', async () => {
    const { host, input, committed } = mountAutocomplete({ options: GENDER });
    input.value = 'Female or woman';
    const action = await fillShadowCombobox(fieldFor(host, 'gender'), 'Male', {});
    expect(action.note).toBe('already filled');
    expect(committed()).toBeNull();
  });

  it('hands the AI fallback the option texts', async () => {
    const { host } = mountAutocomplete({ options: HISPANIC });
    expect(await harvestShadowComboboxOptions(host)).toEqual(HISPANIC);
  });
});

describe('shadow combobox that searches as you type', () => {
  it('commits the typed title through the custom-value option', async () => {
    const { host, committed } = mountAutocomplete({
      search: () => ['Staff Engineer II', 'Staff Engineering Manager'],
      customValues: true,
    });
    const action = await fillShadowCombobox(fieldFor(host, 'jobTitle'), 'Staff Engineer', {});
    expect(action.status).toBe('filled');
    expect(committed()).toBe('Staff Engineer');
  });

  it('takes the location that starts with the saved city and state', async () => {
    const { host, committed } = mountAutocomplete({
      search: () => ['Brooklyn, OH, US', 'Brooklyn, NY, US'],
      manualEntry: true,
    });
    await fillShadowCombobox(fieldFor(host, 'cityAndRegion'), 'Brooklyn, NY', {});
    expect(committed()).toBe('Brooklyn, NY, US');
  });

  it('takes the top location when no suggestion contains the saved text', async () => {
    const { host, committed } = mountAutocomplete({
      search: () => ['Toronto, Ontario, Canada', 'Toronto, OH, US'],
      manualEntry: true,
    });
    const action = await fillShadowCombobox(
      fieldFor(host, 'employerLocation'),
      'Toronto, Canada',
      {},
    );
    expect(action.note).toBe('picked "Toronto, Ontario, Canada"');
    expect(committed()).toBe('Toronto, Ontario, Canada');
  });

  it('never picks the "fill in manually" escape hatch', async () => {
    const { host, input, committed } = mountAutocomplete({ search: () => [], manualEntry: true });
    const action = await fillShadowCombobox(fieldFor(host, 'cityAndRegion'), 'Atlantis', {
      timeoutMs: 300,
    });
    expect(action.status).toBe('skipped');
    expect(action.note).toMatch(/no suggestions/);
    expect(committed()).toBeNull();
    expect(input.value).toBe('');
  });

  it('does not harvest a search box, which has no fixed options to offer', async () => {
    const { host } = mountAutocomplete({ search: () => ['Stripe'] });
    expect(await harvestShadowComboboxOptions(host)).toEqual([]);
  });
});

function mountMonthYearPicker(): { field: DetectedField; input: HTMLInputElement; host: HTMLElement } {
  document.body.innerHTML = '';
  const host = document.createElement('spl-date-field');
  const picker = document.createElement('spl-date-picker');
  host.attachShadow({ mode: 'open' }).appendChild(picker);
  const input = document.createElement('input');
  input.type = 'text';
  picker.attachShadow({ mode: 'open' }).appendChild(input);
  document.body.appendChild(host);
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const m = /^(\d{2})\/(\d{4})$/.exec(input.value);
    if (m) host.setAttribute('value', `${m[2]}-${m[1]}`);
  });
  return {
    host,
    input,
    field: { el: input, kind: 'startDate', label: 'From', confidence: 0.95, widget: 'monthYearPicker' },
  };
}

describe('month-year picker', () => {
  it('types MM/YYYY and presses Enter, which is what makes the picker keep it', () => {
    const { field, host, input } = mountMonthYearPicker();
    const action = fillMonthYearPicker(field, '2022-03', { forceOverwrite: false });
    expect(action.status).toBe('filled');
    expect(input.value).toBe('03/2022');
    expect(host.getAttribute('value')).toBe('2022-03');
  });

  it('skips a To date the form disabled because the job is current', () => {
    const { field, input } = mountMonthYearPicker();
    input.disabled = true;
    expect(fillMonthYearPicker(field, '2024-06', { forceOverwrite: false }).note).toBe(
      'input is disabled',
    );
  });

  it('refuses a value that is not a month', () => {
    const { field } = mountMonthYearPicker();
    expect(fillMonthYearPicker(field, 'last spring', { forceOverwrite: false }).status).toBe(
      'skipped',
    );
  });
});

describe('plain text input inside a shadow root', () => {
  it('really leaves the field, so a component that validates on blur sees it', () => {
    document.body.innerHTML = '';
    const host = document.createElement('spl-input');
    const shadow = host.attachShadow({ mode: 'open' });
    const input = document.createElement('input');
    shadow.appendChild(input);
    document.body.appendChild(host);
    let heard = '';
    host.addEventListener('input', () => (heard = input.value));

    const action = fillField(
      { el: input, kind: 'firstName', label: 'First name', confidence: 0.95 },
      'Ada',
      { forceOverwrite: false },
    );

    expect(action.status).toBe('filled');
    expect(heard).toBe('Ada');
    expect(shadow.activeElement).toBeNull();
  });
});

describe('site answers', () => {
  const SOURCES = ['Career/Job Fair', 'Employee referral', 'Online job board', 'Other'];
  const heard = (host: HTMLElement) => ({
    field: { ...fieldFor(host, 'referralSource'), label: 'How did you hear about this job? *' },
    answer: (options: string[]) => options.find((o) => /job board/i.test(o)) ?? null,
  });

  it('reads the options, lets the adapter choose, and commits the choice', async () => {
    const { host, committed } = mountAutocomplete({ options: SOURCES });
    const action = await fillSiteAnswer(heard(host), { forceOverwrite: false });
    expect(action.status).toBe('filled');
    expect(committed()).toBe('Online job board');
  });

  it('keeps an answer the user already picked', async () => {
    const { host, input, committed } = mountAutocomplete({ options: SOURCES });
    input.value = 'Employee referral';
    const action = await fillSiteAnswer(heard(host), { forceOverwrite: false });
    expect(action.note).toBe('already filled');
    expect(committed()).toBeNull();
  });

  it('reports a miss the AI fallback can retry when no option fits', async () => {
    const { host, committed } = mountAutocomplete({ options: ['Friend', 'Other'] });
    const action = await fillSiteAnswer(heard(host), { forceOverwrite: false });
    expect(action.note).toMatch(/^no option matched/);
    expect(committed()).toBeNull();
  });
});

describe('required agreement box inside a shadow root', () => {
  it('ticks it once and leaves it ticked on a second run', () => {
    document.body.innerHTML = '';
    const host = document.createElement('spl-checkbox');
    const box = document.createElement('input');
    box.type = 'checkbox';
    host.attachShadow({ mode: 'open' }).appendChild(box);
    document.body.appendChild(host);
    const field: DetectedField = {
      el: box,
      kind: 'agreement',
      label: 'I certify that all entries are true *',
      confidence: 0.9,
    };

    expect(fillField(field, true, { forceOverwrite: false }).status).toBe('filled');
    expect(box.checked).toBe(true);
    expect(fillField(field, true, { forceOverwrite: false }).note).toBe('already in desired state');
    expect(box.checked).toBe(true);
  });
});
