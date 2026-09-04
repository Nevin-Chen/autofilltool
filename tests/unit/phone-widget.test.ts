import { describe, expect, it, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { greenhouseAdapter } from '@/adapters/greenhouse';
import { valueForField } from '@/content/mapping';
import { fillField, fillVirtualizedDropdown } from '@/content/filler';
import { emptyProfile } from '@/profile/schema';
import type { Profile } from '@/profile/schema';

const COUNTRY_OPTIONS = [
  'Canada (+1)',
  'United Kingdom (+44)',
  'United States (+1)',
  'United States Minor Outlying Islands (+1)',
];

function fakeReactSelect(input: HTMLInputElement): { committed: () => string | null } {
  let committed: string | null = null;
  let menu: HTMLElement | null = null;

  const render = () => {
    if (!menu) return;
    const query = input.value.trim().toLowerCase();
    const visible = COUNTRY_OPTIONS.filter((o) => o.toLowerCase().includes(query));
    menu.innerHTML = visible
      .map((o) => `<div role="option">${o}</div>`)
      .join('');
  };

  const open = () => {
    if (menu) return;
    menu = document.createElement('div');
    menu.setAttribute('role', 'listbox');
    document.body.appendChild(menu);
    render();
  };

  input.addEventListener('mousedown', open);
  input.addEventListener('input', render);
  input.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'ArrowDown') {
      open();
      return;
    }
    if ((e as KeyboardEvent).key !== 'Enter') return;
    const first = menu?.querySelector('[role="option"]');
    if (!first) return;
    committed = first.textContent;
    menu?.remove();
    menu = null;
    input.value = '';
    const container = input.closest('.select__input-container');
    container?.parentElement?.querySelector('.select__placeholder')?.remove();
    const value = document.createElement('div');
    value.className = 'select__single-value';
    value.textContent = committed;
    container?.parentElement?.prepend(value);
  });

  return { committed: () => committed };
}

describe('greenhouse phone widget — detection through fill', () => {
  let profile: Profile;

  beforeEach(() => {
    document.documentElement.innerHTML = readFileSync(
      resolve(__dirname, '../e2e/fixtures/greenhouse-phone-widget.html'),
      'utf8',
    );
    const p = emptyProfile();
    profile = { ...p, phone: '+1 4155551234', phoneCountry: 'US' };
  });

  it('types the national number only, so the dial code is not doubled', () => {
    const fields = greenhouseAdapter.detectFields(document);
    const phone = fields.find((f) => f.el.id === 'phone')!;

    const action = fillField(phone, valueForField(profile, phone.kind), {
      forceOverwrite: false,
      suppressFlash: true,
    });

    expect(action.status).toBe('filled');
    expect((phone.el as HTMLInputElement).value).toBe('4155551234');
  });

  it('commits a real selection in the dial-code react-select instead of typing into it', async () => {
    const fields = greenhouseAdapter.detectFields(document);
    const country = fields.find((f) => f.el.id === 'country')!;
    const select = fakeReactSelect(country.el as HTMLInputElement);

    const action = await fillVirtualizedDropdown(
      country,
      valueForField(profile, country.kind),
      { forceOverwrite: false, suppressFlash: true },
    );

    expect(action.status).toBe('filled');
    expect(select.committed()).toBe('United States (+1)');
    expect(
      (country.el as HTMLInputElement).value,
      'the search text must not be left behind as the field value',
    ).toBe('');
  });

  it('leaves the picker alone when a country is already selected', async () => {
    const fields = greenhouseAdapter.detectFields(document);
    const country = fields.find((f) => f.el.id === 'country')!;
    document.querySelector('.select__placeholder')!.remove();
    const value = document.createElement('div');
    value.className = 'select__single-value';
    value.textContent = 'Canada (+1)';
    document.querySelector('.select__value-container')!.prepend(value);

    const action = await fillVirtualizedDropdown(
      country,
      valueForField(profile, country.kind),
      { forceOverwrite: false, suppressFlash: true },
    );

    expect(action.status).toBe('skipped');
    expect(action.note).toBe('already filled');
  });
});
