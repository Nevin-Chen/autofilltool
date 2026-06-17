import { describe, expect, it } from 'vitest';
import { valueForField } from '@/content/mapping';
import { fromKeywords } from '@/adapters/_shared';
import { emptyProfile } from '@/profile/schema';
import type { Profile } from '@/profile/schema';
import type { FieldKind } from '@/adapters/types';

function withEducation(overrides: Partial<Profile['education']>): Profile {
  const p = emptyProfile();
  return { ...p, education: { ...p.education, ...overrides } };
}

describe('valueForField — education', () => {
  it('maps each education field to its stored value', () => {
    const p = withEducation({
      school: 'University of Waterloo',
      degree: 'BSc',
      fieldOfStudy: 'Computer Science',
      gradYear: '2024',
    });
    expect(valueForField(p, 'school')).toBe('University of Waterloo');
    expect(valueForField(p, 'degree')).toBe('BSc');
    expect(valueForField(p, 'fieldOfStudy')).toBe('Computer Science');
    expect(valueForField(p, 'gradYear')).toBe('2024');
  });

  it('returns null for empty education fields so the filler skips them', () => {
    const p = emptyProfile();
    expect(valueForField(p, 'school')).toBeNull();
    expect(valueForField(p, 'degree')).toBeNull();
    expect(valueForField(p, 'fieldOfStudy')).toBeNull();
    expect(valueForField(p, 'gradYear')).toBeNull();
  });
});

describe('fromKeywords — education labels', () => {
  const cases: Array<[string, FieldKind]> = [
    ['school', 'school'],
    ['university', 'school'],
    ['college', 'school'],
    ['degree', 'degree'],
    ['field of study', 'fieldOfStudy'],
    ['major', 'fieldOfStudy'],
    ['graduation year', 'gradYear'],
    ['grad date', 'gradYear'],
  ];

  for (const [label, kind] of cases) {
    it(`classifies "${label}" as ${kind}`, () => {
      expect(fromKeywords(label)?.kind).toBe(kind);
    });
  }

  it('prefers graduation year over a stray school mention in a combined label', () => {
    expect(fromKeywords('school graduation year')?.kind).toBe('gradYear');
  });
});
