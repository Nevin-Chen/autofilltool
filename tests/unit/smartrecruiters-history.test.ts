import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { smartRecruitersAdapter } from '@/adapters/smartrecruiters';
import { rebuildHistory, type HistoryFill } from '@/content/history-rebuild';
import { fillDetectedField } from '@/content/filler';
import { valueForField } from '@/content/mapping';
import { emptyEducation, emptyExperience, emptyProfile } from '@/profile/schema';
import type { HistoryGroupKind } from '@/adapters/types';
import type { Profile } from '@/profile/schema';
import { attachShadowTemplates, loadShadowFixture, shadowInput } from './shadow-dom';

const editor = smartRecruitersAdapter.historyEditor!;

const PROFILE: Profile = {
  ...emptyProfile(),
  experience: [
    {
      ...emptyExperience(),
      jobTitle: 'Staff Engineer',
      employer: 'Stripe',
      location: 'Toronto, ON',
      startDate: '2022-03',
      current: true,
      description: 'Led the payments ledger migration.',
    },
    {
      ...emptyExperience(),
      jobTitle: 'Senior Engineer',
      employer: 'Shopify',
      startDate: '2019-07',
      endDate: '2022-02',
    },
  ],
  education: [
    {
      ...emptyEducation(),
      school: 'University of Waterloo',
      degree: "Bachelor's Degree",
      fieldOfStudy: 'Computer Science',
      startDate: '2015-09',
      endDate: '2019-06',
    },
  ],
};

type Page = { dialogs: number; saved: Array<Record<string, string>> };

const SHADOW_BUTTON = '<template shadowrootmode="open"><button type="button"><slot></slot></button></template>';

function hostIn(path: EventTarget[], tag: string): HTMLElement | undefined {
  return path.find(
    (n): n is HTMLElement => n instanceof HTMLElement && n.tagName.toLowerCase() === tag,
  );
}

function committed(scope: ParentNode, selector: string): string {
  const host = scope.querySelector(selector);
  if (!host) return '';
  return host.getAttribute('value') ?? (shadowInput(host).value || '');
}

function fakeSmartRecruiters(signal: AbortSignal): Page {
  const page: Page = { dialogs: 0, saved: [] };

  const addEntry = (kind: HistoryGroupKind) => {
    const template = document.getElementById(`${kind}-entry-form`) as HTMLTemplateElement;
    const entry = template.content.firstElementChild!.cloneNode(true) as HTMLElement;
    const list = document.querySelector(`oc-${kind} [data-test="${kind}"]`)!;
    const first = list.querySelector(`oc-${kind}-entry`);
    list.insertBefore(entry, first);
    attachShadowTemplates(entry);
  };

  const saveEntry = (kind: HistoryGroupKind, button: HTMLElement) => {
    const entry = button.closest<HTMLElement>(`oc-${kind}-entry`)!;
    const values =
      kind === 'experience'
        ? {
            title: committed(entry, '[data-test="job-title-autocomplete"]'),
            detail: committed(entry, '[data-test="company-autocomplete"]'),
            from: committed(entry, 'oc-datepicker[formcontrolname="startDate"] spl-date-field'),
          }
        : {
            title: committed(entry, '[data-test="institution-autocomplete"]'),
            detail: shadowInput(entry.querySelector('oc-input[formcontrolname="major"] spl-input')!).value,
            from: committed(entry, 'oc-datepicker[formcontrolname="startDate"] spl-date-field'),
          };
    if (!values.title) return;
    page.saved.push(values);
    const [title, detail] =
      kind === 'experience'
        ? ['experience-entry-title', 'experience-entry-company']
        : ['education-entry-institution', 'education-entry-major'];
    const card = document.createElement(`oc-${kind}-entry`);
    card.innerHTML = `<div data-test="${kind}-entry"><p data-test="${title}"></p><p data-test="${detail}"></p><spl-button data-test="${kind}-entry-delete" aria-label="Delete ${kind}">${SHADOW_BUTTON}</spl-button></div>`;
    card.querySelector(`[data-test="${title}"]`)!.append(
      values.title,
      Object.assign(document.createElement('span'), { textContent: values.from || 'n/a' }),
    );
    card.querySelector(`[data-test="${title}"] span`)!.setAttribute('data-test', `${kind}-entry-date`);
    card.querySelector(`[data-test="${detail}"]`)!.textContent = values.detail;
    entry.replaceWith(card);
    attachShadowTemplates(card);
  };

  let pendingDelete: HTMLElement | null = null;
  const askToDelete = (entry: HTMLElement) => {
    pendingDelete = entry;
    page.dialogs++;
    const base = document.createElement('div');
    base.className = 'spl-dialog-base-container';
    base.innerHTML = `<div class="spl-dialog-container"><spl-dialog open="" title="Experience">Would you like to delete this entry?<spl-button type="secondary">${SHADOW_BUTTON}No</spl-button><spl-button type="primary">${SHADOW_BUTTON}Yes</spl-button></spl-dialog></div>`;
    document.body.appendChild(base);
    attachShadowTemplates(base);
  };

  document.addEventListener(
    'click',
    (event) => {
      const path = event.composedPath();
      const option = path.find(
        (n): n is HTMLElement => n instanceof HTMLElement && n.getAttribute('role') === 'option',
      );
      const autocomplete = hostIn(path, 'spl-autocomplete');
      if (option && autocomplete) {
        const text = hostIn(path, 'spl-select-option')!.textContent!.trim();
        autocomplete.setAttribute('value', text);
        shadowInput(autocomplete).value = text;
        autocomplete.shadowRoot!.querySelector('[role="listbox"]')!.replaceChildren();
        return;
      }
      const button = hostIn(path, 'spl-button');
      if (!button) return;
      const test = button.getAttribute('data-test') ?? button.closest('oc-button')?.getAttribute('data-test') ?? '';
      if (test === 'add-experience') return addEntry('experience');
      if (test === 'add-education') return addEntry('education');
      if (test === 'experience-save') return saveEntry('experience', button);
      if (test === 'education-save') return saveEntry('education', button);
      if (test.endsWith('-entry-delete')) {
        return askToDelete(button.closest<HTMLElement>('oc-experience-entry, oc-education-entry')!);
      }
      if (button.getAttribute('type') === 'primary' && button.closest('spl-dialog')) {
        pendingDelete?.remove();
        button.closest('.spl-dialog-base-container')!.remove();
      }
    },
    { signal },
  );

  document.addEventListener(
    'input',
    (event) => {
      const path = event.composedPath();
      const autocomplete = hostIn(path, 'spl-autocomplete');
      if (!autocomplete) return;
      const query = (path[0] as HTMLInputElement).value.trim();
      const choices = autocomplete.hasAttribute('allowcustomvalues')
        ? [query]
        : [`${query}, Canada`, 'Cannot find your city? Click here to fill in manually'];
      autocomplete.shadowRoot!.querySelector('[role="listbox"]')!.replaceChildren(
        ...choices.map((text) => {
          const option = document.createElement('spl-select-option');
          option.setAttribute('value', text.startsWith('Cannot') ? 'goToManualLocationMode' : text);
          option.textContent = text;
          const row = document.createElement('div');
          row.setAttribute('role', 'option');
          option.attachShadow({ mode: 'open' }).appendChild(row);
          return option;
        }),
      );
    },
    { signal },
  );

  document.addEventListener(
    'keydown',
    (event) => {
      if ((event as KeyboardEvent).key !== 'Enter') return;
      const path = event.composedPath();
      const field = hostIn(path, 'spl-date-field');
      const m = /^(\d{2})\/(\d{4})$/.exec((path[0] as HTMLInputElement).value);
      if (field && m) field.setAttribute('value', `${m[2]}-${m[1]}`);
    },
    { signal },
  );

  return page;
}

const quickFill =
  (profile: Profile): HistoryFill =>
  async (field) => {
    const value = valueForField(profile, field.kind, field.label, field.group);
    if (typeof value === 'string' && value) {
      if (field.widget === 'shadowCombobox') {
        field.el.setAttribute('value', value);
      } else if (field.el instanceof HTMLInputElement || field.el instanceof HTMLTextAreaElement) {
        field.el.value = value;
      }
    }
    return { label: field.label, kind: field.kind, status: value ? 'filled' : 'skipped' };
  };

function summaries(kind: HistoryGroupKind) {
  return editor.entries(document, kind).map((entry) => editor.summary(entry));
}

describe('SmartRecruiters history rebuild', () => {
  let controller: AbortController;
  let page: Page;

  beforeEach(() => {
    loadShadowFixture('smartrecruiters-apply.html', 'smartrecruiters-entry-forms.html');
    controller = new AbortController();
    page = fakeSmartRecruiters(controller.signal);
  });

  afterEach(() => controller.abort());

  it('replaces the parsed cards with the saved entries, in profile order', async () => {
    const outcomes = await rebuildHistory(document, editor, PROFILE, quickFill(PROFILE));

    expect(page.dialogs).toBe(2);
    expect(summaries('experience')).toEqual([
      { title: 'Staff Engineer', detail: 'Stripe' },
      { title: 'Senior Engineer', detail: 'Shopify' },
    ]);
    expect(summaries('education')).toEqual([
      { title: 'University of Waterloo', detail: 'Computer Science' },
    ]);
    expect(outcomes.map((o) => [o.action.label, o.action.status])).toEqual([
      ['Work history 2: Senior Engineer, Shopify', 'filled'],
      ['Work history 1: Staff Engineer, Stripe', 'filled'],
      ['Education 1: University of Waterloo, Computer Science', 'filled'],
    ]);
    expect(outcomes.every((o) => o.el?.isConnected)).toBe(true);
    expect(document.querySelector('spl-dialog')).toBeNull();
  });

  it('leaves the page alone on a second run once the cards match', async () => {
    await rebuildHistory(document, editor, PROFILE, quickFill(PROFILE));
    const dialogsAfterFirst = page.dialogs;

    const again = await rebuildHistory(document, editor, PROFILE, quickFill(PROFILE));

    expect(page.dialogs).toBe(dialogsAfterFirst);
    expect(again.map((o) => o.action.note)).toEqual([
      'entries already match your profile',
      'entries already match your profile',
    ]);
  });

  it('keeps the parsed cards when the profile has no work history to put in their place', async () => {
    const profile = { ...PROFILE, experience: [] };
    await rebuildHistory(document, editor, profile, quickFill(profile));

    expect(page.dialogs).toBe(0);
    expect(summaries('experience').map((s) => s.detail)).toEqual(['Ottawa, ON', 'Stripe']);
    expect(summaries('education')).toHaveLength(1);
  });

  it('stops and leaves the form open when the site will not save an entry', async () => {
    const profile: Profile = {
      ...PROFILE,
      experience: [{ ...emptyExperience(), employer: 'Recursion Pharma', startDate: '2018-01' }],
    };
    const outcomes = await rebuildHistory(document, editor, profile, quickFill(profile));

    expect(outcomes[0]!.action.status).toBe('error');
    expect(outcomes[0]!.action.note).toMatch(/left open/);
    expect(editor.openForm(document, 'experience')).not.toBeNull();
  });

  it('reports nothing on the screening step, which has no history sections', async () => {
    loadShadowFixture('smartrecruiters-screening.html');
    expect(await rebuildHistory(document, editor, PROFILE, quickFill(PROFILE))).toEqual([]);
  });

  it('deletes nothing when the section has no Add button to put entries back with', async () => {
    document.querySelector('oc-button[data-test="add-experience"]')!.remove();
    const outcomes = await rebuildHistory(document, editor, PROFILE, quickFill(PROFILE));

    expect(page.dialogs).toBe(0);
    expect(editor.entries(document, 'experience')).toHaveLength(2);
    expect(outcomes.map((o) => o.action.kind)).toEqual(['education']);
  });

  it('does not touch a section while the user has an entry open', async () => {
    editor.addButton(document, 'experience')!.click();
    const outcomes = await rebuildHistory(document, editor, PROFILE, quickFill(PROFILE));

    expect(outcomes[0]!.action.note).toMatch(/open for editing/);
    expect(page.dialogs).toBe(0);
    expect(editor.entries(document, 'experience')).toHaveLength(2);
  });

  it('refuses a Save button that reads like a submit', async () => {
    const template = document.getElementById('experience-entry-form') as HTMLTemplateElement;
    template.content
      .querySelector('oc-button[data-test="experience-save"] spl-button')!
      .setAttribute('aria-label', 'Submit application');
    const outcomes = await rebuildHistory(document, editor, PROFILE, quickFill(PROFILE));

    expect(outcomes.find((o) => o.action.status === 'error')!.action.note).toMatch(/left open/);
    expect(page.saved.map((s) => s.title)).toEqual(['University of Waterloo']);
    expect(editor.openForm(document, 'experience')).not.toBeNull();
  });

  it(
    'commits typed titles, locations, and dates through the real widgets',
    async () => {
      const profile: Profile = { ...PROFILE, experience: [PROFILE.experience[0]!] };
      const fill: HistoryFill = (field) =>
        fillDetectedField(
          field,
          valueForField(profile, field.kind, field.label, field.group),
          { forceOverwrite: true, suppressFlash: true },
        );
      const outcomes = await rebuildHistory(document, editor, profile, fill);

      expect(page.saved).toEqual([
        { title: 'Staff Engineer', detail: 'Stripe', from: '2022-03' },
        { title: 'University of Waterloo', detail: 'Computer Science', from: '2015-09' },
      ]);
      expect(outcomes.map((o) => o.action.note)).toEqual([
        'filled 6 fields',
        'filled 5 fields',
      ]);
    },
    15_000,
  );
});
