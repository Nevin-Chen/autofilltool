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

describe('valueForField — cityAndRegion composition', () => {
  function withAddress(overrides: Partial<Profile['address']>): Profile {
    const p = emptyProfile();
    return { ...p, address: { ...p.address, ...overrides } };
  }

  it('joins city and region with ", "', () => {
    const p = withAddress({ city: 'Brooklyn', region: 'NY' });
    expect(valueForField(p, 'cityAndRegion')).toBe('Brooklyn, NY');
  });

  it('falls back to whichever side is set when the other is empty', () => {
    expect(valueForField(withAddress({ city: 'Brooklyn', region: '' }), 'cityAndRegion')).toBe(
      'Brooklyn',
    );
    expect(valueForField(withAddress({ city: '', region: 'NY' }), 'cityAndRegion')).toBe('NY');
  });

  it('returns null when both city and region are empty', () => {
    expect(valueForField(withAddress({ city: '', region: '' }), 'cityAndRegion')).toBeNull();
  });
});

describe('valueForField — phone split for widgets with their own dial-code picker', () => {
  function withPhone(phone: string, phoneCountry: string, country = ''): Profile {
    const p = emptyProfile();
    return { ...p, phone, phoneCountry, address: { ...p.address, country } };
  }

  it('keeps the dial code on a plain phone input but strips it for the national field', () => {
    const p = withPhone('+1 4155551234', 'US');
    expect(valueForField(p, 'phone')).toBe('+1 4155551234');
    expect(valueForField(p, 'phoneNational')).toBe('4155551234');
    expect(valueForField(p, 'phoneCountry')).toBe('United States');
  });

  it('infers the dial-code country from the number when no country was picked', () => {
    const p = withPhone('+44 7700900123', '');
    expect(valueForField(p, 'phoneCountry')).toBe('United Kingdom');
    expect(valueForField(p, 'phoneNational')).toBe('7700900123');
  });

  it('falls back to the address country when the number carries no dial code', () => {
    const p = withPhone('4155551234', '', 'United States');
    expect(valueForField(p, 'phoneCountry')).toBe('United States');
    expect(valueForField(p, 'phoneNational')).toBe('4155551234');
  });

  it('returns null for both when no phone is stored, so the filler skips them', () => {
    const p = withPhone('', '');
    expect(valueForField(p, 'phoneNational')).toBeNull();
    expect(valueForField(p, 'phoneCountry')).toBeNull();
  });
});
