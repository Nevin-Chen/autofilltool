import { describe, expect, it, beforeEach } from 'vitest';
import {
  isCompliancePattern,
  findUnclassifiedFields,
  unclassifiedFromDetected,
} from '@/adapters/_shared';
import { genericAdapter } from '@/adapters/generic';
import { ashbyAdapter } from '@/adapters/ashby';
describe('isCompliancePattern', () => {
  it('flags EEO and immigration variants the broad regex covers', () => {
    const cases = [
      'What is your race?',
      'Race / Ethnicity',
      'Are you Hispanic or Latino?',
      'Disability status',
      'Have you ever served in the military?',
      'Veteran status',
      'Do you require sponsorship?',
      'Will you need a visa?',
      'Are you authorized to work in the US?',
      'work-authorization',
      'H-1B holder?',
      'Are you a US citizen?',
      'Do you hold a green card?',
    ];
    for (const s of cases) {
      expect(isCompliancePattern(s), `should match: ${s}`).toBe(true);
    }
  });

  it('lets neutral questions through', () => {
    const cases = [
      'What is your full name?',
      'Why are you interested in this role?',
      'How did you hear about us?',
      'Address (Please specify City & State)',
    ];
    for (const s of cases) {
      expect(isCompliancePattern(s), `should NOT match: ${s}`).toBe(false);
    }
  });
});

describe('findUnclassifiedFields', () => {
  beforeEach(() => {
    document.documentElement.innerHTML = '<head></head><body></body>';
  });

  it('skips elements already in the classified set', () => {
    document.body.innerHTML = `
      <form>
        <label for="fn">First name</label>
        <input id="fn" name="firstName" type="text" />
        <label for="q1">How did you hear about us?</label>
        <input id="q1" name="hear_about" type="text" />
      </form>
    `;
    const fn = document.getElementById('fn')!;
    const classified = [
      { el: fn, kind: 'firstName' as const, label: 'First name', confidence: 0.99 },
    ];
    const unclassified = findUnclassifiedFields(document, classified);
    const labels = unclassified.map((u) => u.label);
    expect(labels).toContain('How did you hear about us?');
    expect(labels).not.toContain('First name');
  });

  it('groups radio sets into one entry with options', () => {
    document.body.innerHTML = `
      <form>
        <fieldset>
          <label for="favorite-color">Favorite color?</label>
          <input type="radio" id="c-blue" name="color" />
          <label for="c-blue">Blue</label>
          <input type="radio" id="c-green" name="color" />
          <label for="c-green">Green</label>
        </fieldset>
      </form>
    `;
    const unclassified = findUnclassifiedFields(document, []);
    const radios = unclassified.filter((u) => u.fieldType === 'radio');
    expect(radios.length).toBe(1);
    expect(radios[0]?.options).toEqual(['Blue', 'Green']);
  });

  it('captures select options', () => {
    document.body.innerHTML = `
      <form>
        <label for="size">T-shirt size</label>
        <select id="size" name="size">
          <option value="">--</option>
          <option value="s">Small</option>
          <option value="m">Medium</option>
        </select>
      </form>
    `;
    const unclassified = findUnclassifiedFields(document, []);
    const sel = unclassified.find((u) => u.fieldType === 'select');
    expect(sel?.options).toEqual(['--', 'Small', 'Medium']);
  });

  it('skips comboboxes labeled with a generic widget sub-control word', () => {
    document.body.innerHTML = `
      <form>
        <label for="phone">Phone</label>
        <input id="phone" type="tel" name="phone" />
        <div class="flag-dropdown">
          <input id="dial-search" type="text" role="combobox"
                 aria-label="Search" aria-haspopup="listbox" />
        </div>
        <label for="real-q">How many years of experience?</label>
        <input id="real-q" type="text" role="combobox" aria-haspopup="listbox" />
      </form>
    `;
    const unclassified = findUnclassifiedFields(document, []);
    const labels = unclassified.map((u) => u.label);
    expect(labels).not.toContain('Search');
    expect(labels).toContain('How many years of experience?');
  });

  it('claims an <input role="combobox"> before the plain-input walk', () => {
    document.body.innerHTML = `
      <form>
        <label for="country">Country of residence</label>
        <input id="country" type="text" role="combobox" aria-haspopup="listbox" />
      </form>
    `;
    const unclassified = findUnclassifiedFields(document, []);
    const country = unclassified.find((u) => u.el.id === 'country');
    expect(country?.fieldType).toBe('combobox');
    const texts = unclassified.filter((u) => u.fieldType === 'text');
    expect(texts.length).toBe(0);
  });
});

describe('adapter.detectAll() delegation', () => {
  it('generic adapter surfaces both classified and unclassified fields', () => {
    document.body.innerHTML = `
      <form>
        <label for="email">Email</label>
        <input id="email" type="email" />
        <label for="custom">Custom unmapped question</label>
        <input id="custom" type="text" />
      </form>
    `;
    const result = genericAdapter.detectAll!(document);
    expect(result.classified.some((f) => f.kind === 'email')).toBe(true);
    const labels = result.unclassified.map((u) => u.label);
    expect(labels).toContain('Custom unmapped question');
  });

  it('ashby adapter exposes detectAll', () => {
    expect(typeof ashbyAdapter.detectAll).toBe('function');
  });
});
describe('unclassifiedFromDetected', () => {
  beforeEach(() => {
    document.documentElement.innerHTML = '<head></head><body></body>';
  });

  it('extracts options for native <select>', () => {
    document.body.innerHTML = `
      <label for="country">Country</label>
      <select id="country">
        <option value="">--</option>
        <option value="us">United States</option>
        <option value="ca">Canada</option>
      </select>
    `;
    const el = document.getElementById('country') as HTMLSelectElement;
    const u = unclassifiedFromDetected({
      el,
      kind: 'country',
      label: 'Country',
      confidence: 0.85,
    });
    expect(u?.fieldType).toBe('select');
    expect(u?.options).toEqual(['--', 'United States', 'Canada']);
  });

  it('returns textarea fieldType with no options', () => {
    document.body.innerHTML = `
      <label for="why">Why us?</label>
      <textarea id="why"></textarea>
    `;
    const el = document.getElementById('why') as HTMLTextAreaElement;
    const u = unclassifiedFromDetected({
      el,
      kind: 'openEnded',
      label: 'Why us?',
      confidence: 0.5,
    });
    expect(u?.fieldType).toBe('textarea');
    expect(u?.options).toBeUndefined();
  });

  it('collects radio group options from siblings sharing a name', () => {
    document.body.innerHTML = `
      <fieldset>
        <legend>Open to relocation?</legend>
        <input type="radio" name="reloc" id="r-yes" /><label for="r-yes">Yes</label>
        <input type="radio" name="reloc" id="r-no" /><label for="r-no">No</label>
      </fieldset>
    `;
    const first = document.getElementById('r-yes') as HTMLInputElement;
    const u = unclassifiedFromDetected({
      el: first,
      kind: 'willingToRelocate',
      label: 'Open to relocation?',
      confidence: 0.75,
    });
    expect(u?.fieldType).toBe('radio');
    expect(u?.options).toEqual(['Yes', 'No']);
  });

  it('marks virtualizedDropdown widgets as combobox', () => {
    document.body.innerHTML = `
      <div id="trigger" role="combobox">Pick…</div>
    `;
    const el = document.getElementById('trigger') as HTMLElement;
    const u = unclassifiedFromDetected({
      el,
      kind: 'country',
      label: 'Country',
      confidence: 0.85,
      widget: 'virtualizedDropdown',
    });
    expect(u?.fieldType).toBe('combobox');
  });

  it('returns null for checkboxes and file inputs', () => {
    document.body.innerHTML = `
      <input type="checkbox" id="cb" />
      <input type="file" id="f" />
    `;
    const cb = document.getElementById('cb') as HTMLInputElement;
    const f = document.getElementById('f') as HTMLInputElement;
    expect(
      unclassifiedFromDetected({
        el: cb,
        kind: 'authorizedToWorkInUS',
        label: 'Confirm',
        confidence: 0.5,
      }),
    ).toBeNull();
    expect(
      unclassifiedFromDetected({
        el: f,
        kind: 'otherLink',
        label: 'Upload',
        confidence: 0.5,
      }),
    ).toBeNull();
  });

  it('returns null when the label is empty', () => {
    document.body.innerHTML = `<input type="text" id="t" />`;
    const t = document.getElementById('t') as HTMLInputElement;
    expect(
      unclassifiedFromDetected({
        el: t,
        kind: 'firstName',
        label: '',
        confidence: 0.9,
      }),
    ).toBeNull();
  });
});
