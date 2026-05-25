import { describe, expect, it, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { genericAdapter } from '@/adapters/generic';
import type { FieldKind } from '@/adapters/types';

function loadFixture(): string {
  const path = resolve(__dirname, '../e2e/fixtures/generic-form.html');
  return readFileSync(path, 'utf8');
}

function detectByName(name: string, fields: ReturnType<typeof genericAdapter.detectFields>) {
  return fields.find((f) => (f.el as HTMLInputElement).name === name);
}

describe('generic adapter — fixture form', () => {
  beforeEach(() => {
    document.documentElement.innerHTML = loadFixture();
  });

  it('classifies the obvious fields', () => {
    const fields = genericAdapter.detectFields(document);

    const expected: Array<[string, FieldKind]> = [
      ['first_name', 'firstName'],
      ['last_name', 'lastName'],
      ['email', 'email'],
      ['phone', 'phone'],
      ['address1', 'addressLine1'],
      ['city', 'city'],
      ['state', 'region'],
      ['postal_code', 'postalCode'],
      ['country', 'country'],
      ['linkedin_url', 'linkedin'],
      ['github_url', 'github'],
      ['portfolio_url', 'portfolio'],
      ['cover_letter', 'coverLetter'],
      ['why_us', 'openEnded'],
    ];

    for (const [name, kind] of expected) {
      const f = detectByName(name, fields);
      expect(f, `missing field for ${name}`).toBeDefined();
      expect(f?.kind, `wrong kind for ${name}`).toBe(kind);
    }
  });

  it('detects work-auth radio groups', () => {
    const fields = genericAdapter.detectFields(document);
    const radios = fields.filter(
      (f) => (f.el as HTMLInputElement).type === 'radio',
    );
    expect(radios.length).toBeGreaterThan(0);
    const kinds = new Set(radios.map((r) => r.kind));
    expect(kinds.has('authorizedToWorkInUS')).toBe(true);
    expect(kinds.has('requiresSponsorship')).toBe(true);
  });

  it('skips disabled, hidden, and submit inputs', () => {
    document.body.innerHTML += `
      <input id="hid" type="hidden" name="hid" value="x" />
      <input id="dis" name="should_skip" disabled />
      <button type="submit" id="btn">Submit application</button>
    `;
    const fields = genericAdapter.detectFields(document);
    expect(detectByName('hid', fields)).toBeUndefined();
    expect(detectByName('should_skip', fields)).toBeUndefined();
  });
});
