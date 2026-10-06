import { describe, expect, it, beforeEach } from 'vitest';
import { smartRecruitersAdapter } from '@/adapters/smartrecruiters';
import { pickAdapter } from '@/content/detector';
import { isRequiredField } from '@/adapters/_shared';
import type { DetectedField } from '@/adapters/types';
import { attachShadowTemplates, loadShadowFixture } from './shadow-dom';

const APPLY_URL = new URL(
  'https://jobs.smartrecruiters.com/oneclick-ui/company/BostonDynamics/publication/0f6c2b9e-1d1a-4a63-9d0e-3c1f5f7a2b10',
);
const editor = smartRecruitersAdapter.historyEditor!;

function byKind(fields: DetectedField[], kind: string): DetectedField[] {
  return fields.filter((f) => f.kind === kind);
}

function openEntryForm(section: 'experience' | 'education'): HTMLElement {
  const template = document.getElementById(`${section}-entry-form`) as HTMLTemplateElement;
  const entry = template.content.firstElementChild!.cloneNode(true) as HTMLElement;
  const list = document.querySelector(`oc-${section} [data-test="${section}"]`)!;
  list.insertBefore(entry, list.querySelector(`oc-${section}-entry`));
  attachShadowTemplates(entry);
  return editor.openForm(document, section)!;
}

describe('SmartRecruiters adapter matching', () => {
  it('claims the one-click apply host before Workday and the generic fallback', () => {
    loadShadowFixture('smartrecruiters-apply.html');
    expect(pickAdapter(APPLY_URL, document).id).toBe('smartrecruiters');
  });

  it('recognises the app by its root element on another host', () => {
    loadShadowFixture('smartrecruiters-screening.html');
    expect(smartRecruitersAdapter.matches(new URL('https://careers.example.com/apply'), document)).toBe(true);
  });

  it('leaves unrelated pages alone', () => {
    document.body.innerHTML = '<form><input name="first_name"></form>';
    expect(smartRecruitersAdapter.matches(new URL('https://careers.example.com/apply'), document)).toBe(false);
  });
});

describe('SmartRecruiters step 1: personal information', () => {
  beforeEach(() => loadShadowFixture('smartrecruiters-apply.html'));

  it('finds every control even though none is reachable from the document', () => {
    expect(document.querySelectorAll('input, textarea')).toHaveLength(0);
    const kinds = smartRecruitersAdapter.detectFields(document).map((f) => f.kind);
    expect(kinds).toEqual([
      'firstName',
      'lastName',
      'email',
      'email',
      'linkedin',
      'twitter',
      'portfolio',
      'openEnded',
      'cityAndRegion',
      'phoneNational',
    ]);
  });

  it('labels controls from the component, not the shadow internals', () => {
    const fields = smartRecruitersAdapter.detectFields(document);
    expect(byKind(fields, 'firstName')[0]!.label).toBe('First name *');
    expect(byKind(fields, 'email').map((f) => f.label)).toEqual(['Email *', 'Confirm your email *']);
    expect(byKind(fields, 'firstName')[0]!.el).toBeInstanceOf(HTMLInputElement);
  });

  it('types the national number into the phone box, not the country search', () => {
    const phone = byKind(smartRecruitersAdapter.detectFields(document), 'phoneNational')[0]!;
    expect((phone.el as HTMLInputElement).type).toBe('tel');
  });

  it('hands the city search to the shadow combobox filler as the component itself', () => {
    const city = byKind(smartRecruitersAdapter.detectFields(document), 'cityAndRegion')[0]!;
    expect(city.widget).toBe('shadowCombobox');
    expect(city.el.tagName.toLowerCase()).toBe('spl-autocomplete');
  });

  it('reports Facebook as unclassified and never touches the history cards', () => {
    const { classified, unclassified } = smartRecruitersAdapter.detectAll!(document);
    expect(unclassified.map((u) => u.label)).toEqual(['Facebook']);
    const inHistory = [...classified, ...unclassified].filter((f) =>
      f.el.closest('oc-experience, oc-education'),
    );
    expect(inHistory).toHaveLength(0);
  });
});

describe('SmartRecruiters résumé slot', () => {
  beforeEach(() => loadShadowFixture('smartrecruiters-apply.html'));

  it('attaches to the Resume box, not the Easy Apply box that re-parses the résumé', async () => {
    const file = new File(['%PDF-1.4'], 'resume.pdf', { type: 'application/pdf' });
    expect(await smartRecruitersAdapter.fillResume!(file, document)).toBe(true);
    const zone = (selector: string) =>
      document.querySelector(selector)!.shadowRoot!.querySelector('input') as HTMLInputElement;
    expect(zone('spl-dropzone[data-test="resume-upload"]').files).toHaveLength(1);
    expect(zone('spl-dropzone[data-test="apply-with-resume-container"]').files ?? []).toHaveLength(0);
  });

  it('treats a file the site already lists as attached', () => {
    expect(smartRecruitersAdapter.resumeAttached!(document)).toBe(false);
    document
      .querySelector('spl-dropzone[data-test="resume-upload"]')!
      .setAttribute('files', '[{"fileName":"resume.pdf"}]');
    expect(smartRecruitersAdapter.resumeAttached!(document)).toBe(true);
  });
});

describe('SmartRecruiters history cards', () => {
  beforeEach(() =>
    loadShadowFixture('smartrecruiters-apply.html', 'smartrecruiters-entry-forms.html'),
  );

  it('reads saved cards without the date range the title line carries', () => {
    const cards = editor.entries(document, 'experience');
    expect(cards.map((c) => editor.summary(c))).toEqual([
      { title: 'Senior Software Engineer at Shopify Ottawa', detail: 'Ottawa, ON' },
      { title: 'Engineer', detail: 'Stripe' },
    ]);
    expect(editor.entries(document, 'education')).toHaveLength(0);
  });

  it('reaches the buttons inside the spl-button shadow roots', () => {
    const [card] = editor.entries(document, 'experience');
    expect(editor.removeButton(card!)!.tagName).toBe('BUTTON');
    expect(editor.addButton(document, 'education')!.tagName).toBe('BUTTON');
    expect(editor.newEntryFirst).toBe(true);
  });

  it('lists an experience form in fill order, with the current-job box before the end date', () => {
    const form = openEntryForm('experience');
    const fields = editor.formFields(form, { kind: 'experience', index: 1 });
    expect(fields.map((f) => [f.kind, f.widget ?? 'native'])).toEqual([
      ['jobTitle', 'shadowCombobox'],
      ['employer', 'shadowCombobox'],
      ['employerLocation', 'shadowCombobox'],
      ['roleDescription', 'native'],
      ['startDate', 'monthYearPicker'],
      ['currentlyEmployed', 'native'],
      ['endDate', 'monthYearPicker'],
    ]);
    expect(fields.every((f) => f.group?.index === 1)).toBe(true);
    const start = fields.find((f) => f.kind === 'startDate')!.el as HTMLInputElement;
    expect(start.type).toBe('text');
    expect(editor.entries(document, 'experience')).toHaveLength(2);
    expect(editor.saveButton(form)!.tagName).toBe('BUTTON');
  });

  it('lists an education form without the location and description it has no profile field for', () => {
    const form = openEntryForm('education');
    const kinds = editor.formFields(form, { kind: 'education', index: 0 }).map((f) => f.kind);
    expect(kinds).toEqual(['school', 'fieldOfStudy', 'degree', 'startDate', 'endDate']);
  });
});

describe('SmartRecruiters step 2: screening questions', () => {
  beforeEach(() => loadShadowFixture('smartrecruiters-screening.html'));

  it('classifies the self-ID selects and strips the definitions link from their labels', () => {
    const fields = smartRecruitersAdapter.detectFields(document);
    expect(fields.map((f) => [f.kind, f.label])).toEqual([
      ['preferredName', 'Preferred first name'],
      ['gender', 'What is your gender?'],
      ['ethnicity', 'Are you Hispanic or Latino?'],
      ['race', 'What is your race (Select one)'],
      ['veteranStatus', 'Veteran self-identification'],
    ]);
    expect(byKind(fields, 'gender')[0]!.widget).toBe('shadowCombobox');
  });

  it('does not read a discharge date or a household question as the applicant\'s veteran status', () => {
    const { unclassified } = smartRecruitersAdapter.detectAll!(document);
    expect(unclassified.map((u) => [u.label, u.fieldType])).toEqual([
      ['How did you hear about this job? *', 'combobox'],
      ['If other, how?', 'text'],
      ['Preferred last name', 'text'],
      ['Military Discharge Date (MM/DD/YYYY)', 'text'],
      [
        'Has anyone in your household ever served, or are they currently serving, in the U.S. military?',
        'combobox',
      ],
    ]);
  });

  it('marks a required select so the AI fallback still answers it with "required only" on', () => {
    const { unclassified } = smartRecruitersAdapter.detectAll!(document);
    const heard = unclassified[0]!;
    expect(heard.widget).toBe('shadowCombobox');
    expect(isRequiredField(heard.el, heard.label)).toBe(true);
  });

  it('never surfaces the certify, terms, or privacy checkboxes, or the multi-selects', () => {
    const { classified, unclassified } = smartRecruitersAdapter.detectAll!(document);
    const labels = [...classified, ...unclassified].map((f) => f.label).join(' | ');
    expect(labels).not.toMatch(/certify|terms|privacy|classifications of protected veterans/i);
  });
});
