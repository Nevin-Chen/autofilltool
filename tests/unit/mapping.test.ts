import { describe, expect, it } from 'vitest';
import { valueForField } from '@/content/mapping';
import { emptyProfile } from '@/profile/schema';
import type { Profile } from '@/profile/schema';

function withWorkAuth(overrides: Partial<Profile['workAuth']>): Profile {
  const p = emptyProfile();
  return { ...p, workAuth: { ...p.workAuth, ...overrides } };
}

describe('valueForField — work authorization yes/no coercion', () => {
  it('returns "Yes" / "No" rather than booleans so selects, text inputs, and listboxes get user-friendly values', () => {
    const yes = withWorkAuth({
      authorizedToWorkInUS: true,
      requiresSponsorship: true,
      willingToRelocate: true,
    });
    expect(valueForField(yes, 'authorizedToWorkInUS')).toBe('Yes');
    expect(valueForField(yes, 'requiresSponsorship')).toBe('Yes');
    expect(valueForField(yes, 'willingToRelocate')).toBe('Yes');

    const no = withWorkAuth({
      authorizedToWorkInUS: false,
      requiresSponsorship: false,
      willingToRelocate: false,
    });
    expect(valueForField(no, 'authorizedToWorkInUS')).toBe('No');
    expect(valueForField(no, 'requiresSponsorship')).toBe('No');
    expect(valueForField(no, 'willingToRelocate')).toBe('No');
  });

  it('returns null when the toggle is unset, so the filler skips the field', () => {
    const unset = withWorkAuth({
      authorizedToWorkInUS: null,
      requiresSponsorship: null,
      willingToRelocate: null,
    });
    expect(valueForField(unset, 'authorizedToWorkInUS')).toBeNull();
    expect(valueForField(unset, 'requiresSponsorship')).toBeNull();
    expect(valueForField(unset, 'willingToRelocate')).toBeNull();
  });
});
