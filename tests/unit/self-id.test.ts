import { describe, expect, it } from 'vitest';
import {
  isCompliancePattern,
  selfIdKindFromLabel,
  fromKeywords,
  normalize,
} from '@/adapters/_shared';
import { buildClassifyPrompt, summarizeProfileForClassifier } from '@/ai/client';
import { mayAnswerComplianceField } from '@/content/ai-fallback';
import { valueForField } from '@/content/mapping';
import { emptyProfile, type Profile } from '@/profile/schema';
import { greenhouseAdapter } from '@/adapters/greenhouse';

const GARNER_LABELS = {
  gender: 'How would you describe your gender identity? (mark all that apply)',
  race: 'How would you describe your racial/ethnic background? (mark all that apply)',
  orientation: 'How would you describe your sexual orientation? (mark all that apply)',
  transgender: 'Do you identify as transgender?',
  disability:
    'Do you have a disability or chronic condition (physical, visual, auditory, cognitive, mental, emotional, or other) that substantially limits one or more of your major life activities, including mobility, communication, and learning?',
  veteran: 'Are you a veteran or active member of the United States Armed Forces?',
} as const;

function profileWithDemographics(over: Partial<Profile['demographics']>): Profile {
  const p = emptyProfile();
  return { ...p, demographics: { ...p.demographics, ...over } };
}

describe('selfIdKindFromLabel', () => {
  it('recognises every demographic question on the Garner Greenhouse form', () => {
    expect(selfIdKindFromLabel(GARNER_LABELS.gender)).toBe('gender');
    expect(selfIdKindFromLabel(GARNER_LABELS.race)).toBe('race');
    expect(selfIdKindFromLabel(GARNER_LABELS.orientation)).toBe('sexualOrientation');
    expect(selfIdKindFromLabel(GARNER_LABELS.transgender)).toBe('transgender');
    expect(selfIdKindFromLabel(GARNER_LABELS.disability)).toBe('disabilityStatus');
    expect(selfIdKindFromLabel(GARNER_LABELS.veteran)).toBe('veteranStatus');
  });

  it('does not claim work-eligibility or ordinary questions', () => {
    const notSelfId = [
      'Are you legally authorized to work in the United States of America?',
      'Will you now or in the future require sponsorship for employment visa status (e.g., H-1B visa status)?',
      'What is your desired salary?',
      'Which state do you currently reside in?',
      'How did you hear about us?',
    ];
    for (const label of notSelfId) {
      expect(selfIdKindFromLabel(label), `should not be self-ID: ${label}`).toBeNull();
    }
  });

  it('keeps "major life activities" out of the fieldOfStudy rule', () => {
    expect(fromKeywords(normalize(GARNER_LABELS.disability))?.kind).toBe(
      'disabilityStatus',
    );
  });

  it('keeps "Preferred First Name" out of the firstName rule', () => {
    expect(fromKeywords(normalize('Preferred First Name'))?.kind).toBe('preferredName');
    expect(fromKeywords(normalize('First Name'))?.kind).toBe('firstName');
  });
});

describe('isCompliancePattern', () => {
  it('covers gender, orientation and transgender, not just the EEOC five', () => {
    expect(isCompliancePattern(GARNER_LABELS.gender)).toBe(true);
    expect(isCompliancePattern(GARNER_LABELS.orientation)).toBe(true);
    expect(isCompliancePattern(GARNER_LABELS.transgender)).toBe(true);
    expect(isCompliancePattern('What are your pronouns?')).toBe(true);
  });
});

describe('greenhouse detection of the demographic block', () => {
  it('classifies each react-select combobox instead of leaving it unlabelled', () => {
    document.documentElement.innerHTML = '<head></head><body></body>';
    document.body.innerHTML = `
      <form id="application-form">
        <div id="demographic-section">
          ${Object.entries(GARNER_LABELS)
            .map(
              ([key, label]) => `
            <div class="select">
              <label id="${key}-label" for="${key}">${label}</label>
              <div class="select__value-container select__value-container--is-multi">
                <div class="select__placeholder">Select...</div>
                <div class="select__input-container" data-value="">
                  <input id="${key}" type="text" role="combobox"
                         aria-labelledby="${key}-label" />
                </div>
              </div>
            </div>`,
            )
            .join('')}
        </div>
      </form>`;

    const byId = new Map(
      greenhouseAdapter.detectFields(document).map((f) => [f.el.id, f.kind]),
    );
    expect(byId.get('gender')).toBe('gender');
    expect(byId.get('race')).toBe('race');
    expect(byId.get('orientation')).toBe('sexualOrientation');
    expect(byId.get('transgender')).toBe('transgender');
    expect(byId.get('disability')).toBe('disabilityStatus');
    expect(byId.get('veteran')).toBe('veteranStatus');
  });
});

describe('valueForField for self-ID kinds', () => {
  it('reads the new orientation and transgender answers', () => {
    const profile = profileWithDemographics({
      sexualOrientation: 'Queer',
      transgender: 'No',
      pronouns: 'he/him',
    });
    expect(valueForField(profile, 'sexualOrientation')).toBe('Queer');
    expect(valueForField(profile, 'transgender')).toBe('No');
    expect(valueForField(profile, 'pronouns')).toBe('he/him');
  });
});

describe('summarizeProfileForClassifier', () => {
  it('labels the Hispanic question as a question, not as "Ethnicity"', () => {
    const summary = summarizeProfileForClassifier(
      profileWithDemographics({ ethnicity: 'No', race: 'Asian' }),
    );
    expect(summary).toContain('Hispanic or Latino: No');
    expect(summary).toContain('Race: Asian');
  });

  it('carries the new self-ID answers', () => {
    const summary = summarizeProfileForClassifier(
      profileWithDemographics({ sexualOrientation: 'Queer', transgender: 'No' }),
    );
    expect(summary).toContain('Sexual orientation: Queer');
    expect(summary).toContain('Identifies as transgender: No');
  });
});

describe('buildClassifyPrompt in self-ID mode', () => {
  const options = ['Man', 'Woman', 'Non-binary', "I don't wish to answer"];

  it('puts the saved answer in front of the model and forbids inventing one', () => {
    const { system, user } = buildClassifyPrompt(
      {
        question: GARNER_LABELS.gender,
        fieldType: 'combobox',
        options,
        selfIdKind: 'gender',
      },
      profileWithDemographics({ gender: 'Male' }),
      { mode: 'selfId' },
    );
    expect(user).toContain("The user's saved answer to this question: Male");
    expect(system).toContain('"Male" maps to "Man"');
    expect(system).toContain('Never contradict the saved answer');
    expect(system).toContain('Never infer a demographic answer from the name');
  });

  it('says plainly when nothing is saved, and points at the decline option', () => {
    const { system, user } = buildClassifyPrompt(
      {
        question: GARNER_LABELS.orientation,
        fieldType: 'combobox',
        options: ['Gay', 'Heterosexual', "I don't wish to answer"],
        selfIdKind: 'sexualOrientation',
      },
      emptyProfile(),
      { mode: 'selfId' },
    );
    expect(user).toContain('The user has not saved an answer to this question.');
    expect(system).toContain('pick the option that declines to answer');
  });

  it('flags the stored Hispanic answer as a yes/no rather than a race', () => {
    const { user } = buildClassifyPrompt(
      {
        question: 'Are you Hispanic or Latino?',
        fieldType: 'select',
        options: ['Yes', 'No'],
        selfIdKind: 'ethnicity',
      },
      profileWithDemographics({ ethnicity: 'No' }),
      { mode: 'selfId' },
    );
    expect(user).toContain("The user's saved answer to this question: Hispanic or Latino: No");
  });

  it('never borrows the preference prompt, which tells the model to guess', () => {
    const { system } = buildClassifyPrompt(
      {
        question: GARNER_LABELS.transgender,
        fieldType: 'combobox',
        options: ['Yes', 'No', "I don't wish to answer"],
        selfIdKind: 'transgender',
      },
      emptyProfile(),
      { mode: 'selfId' },
    );
    expect(system).not.toContain('typical candidate');
    expect(system).not.toContain('YOU MUST ANSWER');
  });
});

describe('mayAnswerComplianceField', () => {
  const gate = (label: string, savedSelfId: string | null, includeCompliance: boolean) =>
    mayAnswerComplianceField({ label, savedSelfId, includeCompliance });

  it('lets a saved answer through with the setting off', () => {
    expect(gate(GARNER_LABELS.race, 'Asian', false)).toBe(true);
    expect(gate(GARNER_LABELS.veteran, 'I am not a protected veteran', false)).toBe(true);
    expect(gate(GARNER_LABELS.disability, "I don't wish to answer", false)).toBe(true);
  });

  it('holds back a blank self-ID question until the setting is on', () => {
    expect(gate(GARNER_LABELS.orientation, null, false)).toBe(false);
    expect(gate(GARNER_LABELS.orientation, null, true)).toBe(true);
    expect(gate(GARNER_LABELS.transgender, '', false)).toBe(false);
  });

  it('still gates visa questions, which have no saved self-ID answer to check', () => {
    const visa =
      'Will you now or in the future require sponsorship for employment visa status (e.g., H-1B visa status)?';
    expect(gate(visa, null, false)).toBe(false);
    expect(gate(visa, null, true)).toBe(true);
  });

  it('leaves ordinary questions alone either way', () => {
    expect(gate('How did you hear about us?', null, false)).toBe(true);
  });
});
