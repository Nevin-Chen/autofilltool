import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { genericAdapter } from '@/adapters/generic';

function load(name: string): string {
  return readFileSync(resolve(__dirname, `../e2e/fixtures/${name}`), 'utf8');
}

describe('no-form signal (US3 scenario 3)', () => {
  it('detects zero candidate fields on a page with no form', () => {
    document.documentElement.innerHTML = load('no-form.html');
    expect(genericAdapter.detectFields(document)).toHaveLength(0);
  });

  it('still detects fields when they are all pre-filled (a normal completion, not no-form)', () => {
    document.documentElement.innerHTML = load('prefilled-only.html');
    expect(genericAdapter.detectFields(document).length).toBeGreaterThan(0);
  });
});
