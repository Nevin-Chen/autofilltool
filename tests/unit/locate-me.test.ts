import { describe, expect, it, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { greenhouseAdapter } from '@/adapters/greenhouse';
import { findLocateButton } from '@/adapters/_shared';
import { valueForField } from '@/content/mapping';
import { fillViaLocateButton } from '@/content/filler';
import { emptyProfile } from '@/profile/schema';
import type { Profile } from '@/profile/schema';
import type { DetectedField } from '@/adapters/types';

function loadFixture(): void {
  document.documentElement.innerHTML = readFileSync(
    resolve(__dirname, '../e2e/fixtures/greenhouse-location-control.html'),
    'utf8',
  );
}

function locationField(): DetectedField {
  const fields = greenhouseAdapter.detectFields(document);
  const field = fields.find((f) => f.el.id === 'candidate-location');
  if (!field) throw new Error('location field not detected');
  return field;
}

function showValue(text: string): void {
  document.querySelector('.select__placeholder')?.remove();
  const value = document.createElement('div');
  value.className = 'select__single-value';
  value.textContent = text;
  document.querySelector('.select__value-container')!.prepend(value);
}

function geocodesOnClick(delayMs: number, text: string): () => number {
  let clicks = 0;
  const button = document.querySelector<HTMLButtonElement>('.btn--tertiary')!;
  button.addEventListener('click', () => {
    clicks++;
    setTimeout(() => showValue(text), delayMs);
  });
  return () => clicks;
}

describe('Greenhouse location control — Locate me', () => {
  let profile: Profile;

  beforeEach(() => {
    loadFixture();
    const p = emptyProfile();
    profile = { ...p, address: { ...p.address, city: 'Brooklyn', region: 'NY' } };
  });

  it('finds the button as a sibling of the combobox, not inside the select shell', () => {
    const trigger = document.getElementById('candidate-location')!;
    expect(findLocateButton(trigger)?.textContent).toBe('Locate me');
  });

  it('marks the location combobox as a locateButton widget', () => {
    const field = locationField();
    expect(field.widget).toBe('locateButton');
    expect(field.kind).toBe('city');
  });

  it('leaves an ordinary combobox on the same form as a normal dropdown', () => {
    const fields = greenhouseAdapter.detectFields(document);
    expect(fields.find((f) => f.el.id === 'gender')?.widget).toBe('virtualizedDropdown');
  });

  it('clicks the button and reports the location it produced', async () => {
    const field = locationField();
    const clicks = geocodesOnClick(20, 'Brooklyn, NY, USA');

    const action = await fillViaLocateButton(field, valueForField(profile, field.kind), {
      suppressFlash: true,
    });

    expect(clicks()).toBe(1);
    expect(action.status).toBe('filled');
    expect(action.note).toBe('used the form\'s "Locate me" button');
    expect(document.querySelector('.select__single-value')?.textContent).toBe(
      'Brooklyn, NY, USA',
    );
  });

  it('falls back to the profile city when geolocation never answers', async () => {
    const field = locationField();
    const button = document.querySelector<HTMLButtonElement>('.btn--tertiary')!;
    let clicked = false;
    button.addEventListener('click', () => (clicked = true));

    let typed = '';
    const trigger = field.el as HTMLInputElement;
    trigger.addEventListener('mousedown', () => {
      const menu = document.createElement('div');
      menu.setAttribute('role', 'listbox');
      menu.innerHTML = '<div role="option">Brooklyn, NY, USA</div>';
      document.body.appendChild(menu);
    });
    trigger.addEventListener('input', () => (typed = trigger.value));

    const action = await fillViaLocateButton(field, valueForField(profile, field.kind), {
      suppressFlash: true,
      timeoutMs: 30,
    });

    expect(clicked, 'it still tries the button first').toBe(true);
    expect(typed).toBe('Brooklyn');
    expect(action.status).toBe('filled');
  });

  it('reports a clear skip when the button fails and the profile has no city', async () => {
    loadFixture();
    const field = locationField();

    const action = await fillViaLocateButton(field, valueForField(emptyProfile(), field.kind), {
      suppressFlash: true,
      timeoutMs: 30,
    });

    expect(action.status).toBe('skipped');
    expect(action.note).toBe('the page never returned a location');
  });

  it('skips the click entirely when the site has geolocation denied', async () => {
    const field = locationField();
    const clicks = geocodesOnClick(0, 'Brooklyn, NY, USA');
    const query = vi.fn().mockResolvedValue({ state: 'denied' });
    Object.defineProperty(navigator, 'permissions', {
      configurable: true,
      value: { query },
    });

    const action = await fillViaLocateButton(field, valueForField(profile, field.kind), {
      suppressFlash: true,
      timeoutMs: 30,
    });

    Reflect.deleteProperty(navigator, 'permissions');
    expect(query).toHaveBeenCalledWith({ name: 'geolocation' });
    expect(clicks(), 'no permission prompt when the answer is already no').toBe(0);
    expect(action.status).toBe('skipped');
    expect(action.note).toBe('dropdown popup did not appear');
  });

  it('leaves a location the user already picked alone', async () => {
    const field = locationField();
    showValue('Oakland, CA, USA');
    const clicks = geocodesOnClick(0, 'Brooklyn, NY, USA');

    const action = await fillViaLocateButton(field, valueForField(profile, field.kind), {
      suppressFlash: true,
    });

    expect(clicks()).toBe(0);
    expect(action.status).toBe('skipped');
    expect(action.note).toBe('already filled');
  });
});
