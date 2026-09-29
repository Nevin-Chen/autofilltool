import { describe, expect, it, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ashbyAdapter } from '@/adapters/ashby';
import { valueForField } from '@/content/mapping';
import { fillButtonGroup, fillField, fillVirtualizedDropdown } from '@/content/filler';
import { emptyProfile } from '@/profile/schema';
import type { Profile } from '@/profile/schema';
import type { DetectedField } from '@/adapters/types';

function loadFixture(): void {
  document.documentElement.innerHTML = readFileSync(
    resolve(__dirname, '../e2e/fixtures/ashby-location.html'),
    'utf8',
  );
}

function locationField(): DetectedField {
  const field = ashbyAdapter
    .detectFields(document)
    .find((f) => f.el.id === '_systemfield_location');
  if (!field) throw new Error('location field not detected');
  return field;
}

function installLocationPopup(results: string[], delayMs: number): () => string[] {
  const input = document.querySelector<HTMLInputElement>('#_systemfield_location')!;
  const chosen: string[] = [];
  let listbox: HTMLElement | null = null;

  const open = (): HTMLElement => {
    if (listbox) return listbox;
    listbox = document.createElement('div');
    listbox.id = 'location-popup';
    listbox.setAttribute('role', 'listbox');
    listbox.addEventListener('click', (e) => {
      const option = (e.target as HTMLElement).closest('[role="option"]');
      if (option) chosen.push((option.textContent ?? '').trim());
    });
    document.body.append(listbox);
    input.setAttribute('aria-controls', listbox.id);
    input.setAttribute('aria-expanded', 'true');
    return listbox;
  };

  input.addEventListener('click', open);
  input.addEventListener('input', () => {
    const popup = open();
    popup.replaceChildren();
    if (!input.value) return;
    setTimeout(() => {
      for (const text of results) {
        const option = document.createElement('div');
        option.setAttribute('role', 'option');
        option.textContent = text;
        popup.append(option);
      }
    }, delayMs);
  });

  return () => chosen;
}

describe('Ashby location field', () => {
  let profile: Profile;

  beforeEach(() => {
    loadFixture();
    const p = emptyProfile();
    profile = { ...p, address: { ...p.address, city: 'Austin', region: 'TX' } };
  });

  it('classifies the system location field even though "Location" matches no keyword', () => {
    const field = locationField();
    expect(field.kind).toBe('cityAndRegion');
    expect(field.widget).toBe('virtualizedDropdown');
  });

  it('does not also queue the location field for the AI fallback', () => {
    const { unclassified } = ashbyAdapter.detectAll!(document);
    expect(unclassified.map((u) => u.el.id)).not.toContain('_systemfield_location');
  });

  it('takes the top suggestion when no result matches the profile string', async () => {
    const chosen = installLocationPopup(
      ['Austin, Texas, United States', 'Austin, Minnesota, United States'],
      120,
    );
    const field = locationField();
    const value = valueForField(profile, field.kind, field.label);
    expect(value).toBe('Austin, TX');

    const action = await fillVirtualizedDropdown(field, value, { suppressFlash: true });

    expect(action.status).toBe('filled');
    expect(action.note).toContain('Austin, Texas, United States');
    expect(chosen()).toEqual(['Austin, Texas, United States']);
  });

  it('waits past the search debounce instead of giving up on the first empty list', async () => {
    const chosen = installLocationPopup(['Austin, Texas, United States'], 700);
    const field = locationField();

    const action = await fillVirtualizedDropdown(field, 'Austin, TX', {
      suppressFlash: true,
    });

    expect(action.status).toBe('filled');
    expect(chosen()).toEqual(['Austin, Texas, United States']);
  });

  it('clears the box and reports a skip when the search returns nothing', async () => {
    installLocationPopup([], 20);
    const field = locationField();
    const input = field.el as HTMLInputElement;

    const action = await fillVirtualizedDropdown(field, 'Austin, TX', {
      suppressFlash: true,
      timeoutMs: 500,
    });

    expect(action.status).toBe('skipped');
    expect(action.note).toContain('no suggestions');
    expect(input.value).toBe('');
  });
});

describe('Ashby choice controls already holding the wanted value', () => {
  beforeEach(loadFixture);

  it('leaves a checked radio alone rather than tripping click-to-deselect', () => {
    const radio = document.querySelector<HTMLInputElement>(
      '#entry-sponsorship-labeled-radio-0',
    )!;
    let deselects = 0;
    radio.addEventListener('click', () => {
      if (radio.checked) deselects++;
    });

    const action = fillField(
      { el: radio, kind: 'requiresSponsorship', label: 'Sponsorship', confidence: 0.9 },
      'no',
      { forceOverwrite: true, suppressFlash: true },
    );

    expect(action.status).toBe('skipped');
    expect(action.note).toBe('already in desired state');
    expect(deselects).toBe(0);
    expect(radio.checked).toBe(true);
  });

  it('still moves a radio group to a different option under overwrite', () => {
    const radio = document.querySelector<HTMLInputElement>(
      '#entry-sponsorship-labeled-radio-0',
    )!;
    const other = document.querySelector<HTMLInputElement>(
      '#entry-sponsorship-labeled-radio-1',
    )!;

    const action = fillField(
      { el: radio, kind: 'requiresSponsorship', label: 'Sponsorship', confidence: 0.9 },
      'yes',
      { forceOverwrite: true, suppressFlash: true },
    );

    expect(action.status).toBe('filled');
    expect(other.checked).toBe(true);
  });

  it('leaves the active Yes button alone rather than toggling it off', () => {
    const group = document.querySelector<HTMLElement>('.ashby-application-form-input-yesno')!;
    const yes = group.querySelector<HTMLButtonElement>('[data-option="yes"]')!;
    let clicks = 0;
    yes.addEventListener('click', () => clicks++);

    const action = fillButtonGroup(
      { el: group, kind: 'authorizedToWorkInUS', label: 'Work authorization', confidence: 0.9 },
      'yes',
      { forceOverwrite: true, suppressFlash: true },
    );

    expect(action.status).toBe('skipped');
    expect(action.note).toBe('already in desired state');
    expect(clicks).toBe(0);
  });

  it('leaves a checkbox that already holds the wanted value alone', () => {
    const box = document.querySelector<HTMLInputElement>('#entry-relocation-consent-input')!;

    const action = fillField(
      { el: box, kind: 'willingToRelocate', label: 'Relocation', confidence: 0.9 },
      true,
      { forceOverwrite: true, suppressFlash: true },
    );

    expect(action.status).toBe('skipped');
    expect(box.checked).toBe(true);
  });
});
