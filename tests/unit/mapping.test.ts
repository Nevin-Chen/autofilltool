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

describe('valueForField — work authorization question polarity', () => {
  const noSponsorship = withWorkAuth({
    authorizedToWorkInUS: true,
    requiresSponsorship: false,
  });

  it('answers No to a "do you require sponsorship" label', () => {
    expect(
      valueForField(
        noSponsorship,
        'requiresSponsorship',
        'Will you now or in the future require sponsorship for employment visa status?',
      ),
    ).toBe('No');
  });

  it('flips to Yes when the same fact is asked as "without sponsorship"', () => {
    expect(
      valueForField(
        noSponsorship,
        'requiresSponsorship',
        'Are you able to work in the US without needing visa sponsorship?',
      ),
    ).toBe('Yes');
  });

  it('falls back to the raw toggle when the label says nothing useful', () => {
    expect(valueForField(noSponsorship, 'requiresSponsorship', 'Sponsorship')).toBe('No');
    expect(valueForField(noSponsorship, 'authorizedToWorkInUS', 'Work status')).toBe('Yes');
  });

  it('leaves a question about how the authorization was obtained to the AI', () => {
    const label =
      'Is your current U.S. work authorization based on your status as a spouse of an H-1B, L-1, or E-1/E-2/E-3 visa holder?';
    expect(valueForField(noSponsorship, 'authorizedToWorkInUS', label)).toBeNull();
    expect(valueForField(noSponsorship, 'requiresSponsorship', label)).toBeNull();
  });

  it('leaves willingToRelocate on the raw toggle regardless of label', () => {
    const p = withWorkAuth({ willingToRelocate: false, requiresSponsorship: false });
    expect(
      valueForField(p, 'willingToRelocate', 'Are you willing to relocate without sponsorship?'),
    ).toBe('No');
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

  it('strips the dial code for the national field', () => {
    const p = withPhone('+1 4155551234', 'US');
    expect(valueForField(p, 'phoneNational')).toBe('415-555-1234');
    expect(valueForField(p, 'phoneCountry')).toBe('United States');
  });

  it('leaves +1 off a plain phone input', () => {
    expect(valueForField(withPhone('+1 4155551234', 'US'), 'phone')).toBe('415-555-1234');
    expect(valueForField(withPhone('+1 416.555.0142', 'CA'), 'phone')).toBe('416-555-0142');
    expect(valueForField(withPhone('4155551234', '', 'United States'), 'phone')).toBe('415-555-1234');
  });

  it('keeps the dial code on a plain phone input for numbers outside North America', () => {
    expect(valueForField(withPhone('+44 7700900123', 'GB'), 'phone')).toBe('+44 7700900123');
    expect(valueForField(withPhone('+44 7700900123', ''), 'phone')).toBe('+44 7700900123');
  });

  it('infers the dial-code country from the number when no country was picked', () => {
    const p = withPhone('+44 7700900123', '');
    expect(valueForField(p, 'phoneCountry')).toBe('United Kingdom');
    expect(valueForField(p, 'phoneNational')).toBe('7700900123');
  });

  it('falls back to the address country when the number carries no dial code', () => {
    const p = withPhone('4155551234', '', 'United States');
    expect(valueForField(p, 'phoneCountry')).toBe('United States');
    expect(valueForField(p, 'phoneNational')).toBe('415-555-1234');
  });

  it('dashes a ten-digit North American number however it was stored', () => {
    expect(valueForField(withPhone('(646) 555-0198', 'US'), 'phoneNational')).toBe('646-555-0198');
    expect(valueForField(withPhone('+1 416.555.0142', 'CA'), 'phoneNational')).toBe('416-555-0142');
  });

  it('leaves a North American number alone when it is not ten digits', () => {
    expect(valueForField(withPhone('+1 555 0142', 'US'), 'phoneNational')).toBe('555 0142');
  });

  it('returns null for every phone kind when no phone is stored, so the filler skips them', () => {
    const p = withPhone('', '');
    expect(valueForField(p, 'phone')).toBeNull();
    expect(valueForField(p, 'phoneNational')).toBeNull();
    expect(valueForField(p, 'phoneCountry')).toBeNull();
  });
});

describe('valueForField — phone country for the Greenhouse dial-code picker', () => {
  function withPhone(phone: string, phoneCountry: string, country: string): Profile {
    const p = emptyProfile();
    return {
      ...p,
      phone,
      phoneCountry,
      address: { ...p.address, country },
    };
  }

  it('reads the country off the dial code when the number carries one', () => {
    const p = withPhone('+1 4155550142', '', '');
    expect(valueForField(p, 'phoneCountry')).toBe('United States');
    expect(valueForField(p, 'phoneNational')).toBe('415-555-0142');
  });

  it('falls back to the address country when the number has no dial code', () => {
    const p = withPhone('4155550142', '', 'USA');
    expect(valueForField(p, 'phoneCountry')).toBe('United States');
    expect(valueForField(p, 'phoneNational')).toBe('415-555-0142');
  });

  it('normalises the address country so it matches a dropdown option', () => {
    expect(valueForField(withPhone('', '', 'USA'), 'country')).toBe('United States');
    expect(valueForField(withPhone('', '', 'U.S.'), 'country')).toBe('United States');
    expect(valueForField(withPhone('', '', 'UK'), 'country')).toBe('United Kingdom');
  });

  it('leaves an unrecognised address country untouched rather than dropping it', () => {
    expect(valueForField(withPhone('', '', 'Atlantis'), 'country')).toBe('Atlantis');
    expect(valueForField(withPhone('', '', ''), 'country')).toBeNull();
  });
});
