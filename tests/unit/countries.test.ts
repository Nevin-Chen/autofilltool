import { describe, expect, it } from 'vitest';
import {
  COUNTRIES,
  countryByIso,
  joinPhone,
  splitPhone,
} from '@/lib/countries';

describe('countries dial-code helpers', () => {
  it('joins an ISO + national number into +dial form', () => {
    expect(joinPhone('US', '555 123 4567')).toBe('+1 555 123 4567');
    expect(joinPhone('GB', '7700 900900')).toBe('+44 7700 900900');
  });

  it('returns empty string when the national part is blank', () => {
    expect(joinPhone('US', '')).toBe('');
    expect(joinPhone('US', '   ')).toBe('');
  });

  it('falls back to the bare number for an unknown ISO', () => {
    expect(joinPhone('', '5551234567')).toBe('5551234567');
    expect(joinPhone('ZZ', '5551234567')).toBe('5551234567');
  });

  it('round-trips join → split with the persisted ISO', () => {
    const stored = joinPhone('DE', '151 23456789');
    expect(splitPhone(stored, 'DE')).toEqual({
      iso: 'DE',
      national: '151 23456789',
    });
  });

  it('infers the country from a +dial prefix when ISO is missing', () => {
    expect(splitPhone('+44 7700 900900')).toEqual({
      iso: 'GB',
      national: '7700 900900',
    });
  });

  it('prefers the longest matching dial code', () => {
    // +1 (US) vs nothing longer that also matches: a 3-digit code shouldn't be
    // shadowed by +1. 351 (Portugal) must win over any 1-prefixed code.
    expect(splitPhone('+351 912345678').iso).toBe('PT');
  });

  it('treats a number without a + prefix as a raw national number', () => {
    expect(splitPhone('5551234567')).toEqual({
      iso: '',
      national: '5551234567',
    });
  });

  it('keeps the saved country even if the number lacks its prefix', () => {
    expect(splitPhone('5551234567', 'US')).toEqual({
      iso: 'US',
      national: '5551234567',
    });
  });

  it('every country resolves by ISO and has a numeric dial code', () => {
    for (const c of COUNTRIES) {
      expect(countryByIso(c.iso)).toBe(c);
      expect(c.dial).toMatch(/^\d+$/);
    }
  });
});
