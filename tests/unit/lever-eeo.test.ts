import { describe, expect, it, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { leverAdapter } from '@/adapters/lever';
import { bestLabel } from '@/adapters/_shared';
import { fillField, pickSelectOption } from '@/content/filler';
import { valueForField } from '@/content/mapping';
import { emptyProfile, type Profile } from '@/profile/schema';

function profileWithDemographics(over: Partial<Profile['demographics']>): Profile {
  const p = emptyProfile();
  return { ...p, demographics: { ...p.demographics, ...over } };
}

const selectNamed = (name: string) =>
  document.querySelector<HTMLSelectElement>(`select[name="${name}"]`)!;

describe('lever EEO survey', () => {
  beforeEach(() => {
    document.documentElement.innerHTML = readFileSync(
      resolve(__dirname, '../e2e/fixtures/lever-eeo.html'),
      'utf8',
    );
  });

  it('labels each question without swallowing its own options', () => {
    const byName = new Map(
      leverAdapter
        .detectFields(document)
        .map((f) => [f.el.getAttribute('name'), f.label]),
    );
    expect(byName.get('eeo[gender]')).toBe('Gender');
    expect(byName.get('eeo[race]')).toBe('Race');
    expect(byName.get('eeo[veteran]')).toBe('Veteran status');
  });

  it('drops the expandable option descriptions out of the Race label', () => {
    const label = bestLabel(selectNamed('eeo[race]'));
    expect(label).toBe('Race');
    expect(label).not.toMatch(/hispanic/i);
  });

  it('classifies eeo[race] as race, not as the Hispanic-or-Latino question', () => {
    const byName = new Map(
      leverAdapter
        .detectFields(document)
        .map((f) => [f.el.getAttribute('name'), f.kind]),
    );
    expect(byName.get('eeo[race]')).toBe('race');
    expect(byName.get('eeo[gender]')).toBe('gender');
    expect(byName.get('eeo[veteran]')).toBe('veteranStatus');
    expect(byName.get('pronouns')).toBe('pronouns');
  });

  it('never answers Race with a option that only negates the ethnicity answer', () => {
    const race = selectNamed('eeo[race]');
    const profile = profileWithDemographics({ ethnicity: 'Not Hispanic or Latino' });
    const action = fillField(
      { el: race, kind: 'ethnicity', label: 'Race', confidence: 0.7 },
      valueForField(profile, 'ethnicity'),
      { forceOverwrite: false, suppressFlash: true },
    );
    expect(action.status).toBe('skipped');
    expect(race.value).toBe('');
  });

  it('fills Race from the saved race answer', () => {
    const race = selectNamed('eeo[race]');
    const profile = profileWithDemographics({ race: 'Asian' });
    const action = fillField(
      { el: race, kind: 'race', label: 'Race', confidence: 0.7 },
      valueForField(profile, 'race'),
      { forceOverwrite: false, suppressFlash: true },
    );
    expect(action.status).toBe('filled');
    expect(race.value).toBe('Asian (Not Hispanic or Latino)');
  });

  it('hands an unmatched veteran wording to the AI fallback instead of erroring', () => {
    const vet = selectNamed('eeo[veteran]');
    const profile = profileWithDemographics({
      veteranStatus: 'I am not a protected veteran',
    });
    const action = fillField(
      { el: vet, kind: 'veteranStatus', label: 'Veteran status', confidence: 0.7 },
      valueForField(profile, 'veteranStatus'),
      { forceOverwrite: false, suppressFlash: true },
    );
    expect(action.status).toBe('skipped');
    expect(action.note).toMatch(/no option matched/i);
    expect(vet.value).toBe('');
  });

  it('maps a decline answer onto the survey wording', () => {
    expect(pickSelectOption(selectNamed('eeo[gender]'), "I don't wish to answer")).toBe(
      'Decline to self-identify',
    );
  });
});
