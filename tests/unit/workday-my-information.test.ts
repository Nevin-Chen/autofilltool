import { describe, expect, it, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { workdayAdapter } from '@/adapters/workday';
import { unclassifiedFromDetected } from '@/adapters/_shared';
import { valueForField } from '@/content/mapping';
import { fillDetectedField, fillSiteAnswer } from '@/content/filler';
import { emptyProfile } from '@/profile/schema';
import type { SiteAnswer } from '@/adapters/types';
import type { Profile } from '@/profile/schema';

const PROFILE: Profile = {
  ...emptyProfile(),
  firstName: 'Jordan',
  lastName: 'Rivera',
  phone: '+1 212 555 0142',
  phoneCountry: 'US',
  address: {
    ...emptyProfile().address,
    line1: '41 State St',
    city: 'Albany',
    region: 'NY',
    postalCode: '12207',
    country: 'United States',
  },
};

const STATES = ['Select One', 'New Hampshire', 'New Jersey', 'New Mexico', 'New York', 'North Carolina'];

function loadFixture(): void {
  document.documentElement.innerHTML = readFileSync(
    resolve(__dirname, '../e2e/fixtures/workday-my-information.html'),
    'utf8',
  );
}

function input(id: string): HTMLInputElement {
  const el = document.getElementById(id);
  if (!(el instanceof HTMLInputElement)) throw new Error(`no input "${id}"`);
  return el;
}

function installStateListbox(): void {
  installListbox('address--countryRegion', STATES);
}

function installListbox(buttonId: string, options: string[]): void {
  const button = document.getElementById(buttonId)!;
  button.addEventListener('click', () => {
    if (document.getElementById(`${buttonId}-options`)) return;
    const list = document.createElement('ul');
    list.id = `${buttonId}-options`;
    list.setAttribute('role', 'listbox');
    for (const name of options) {
      const li = document.createElement('li');
      li.setAttribute('role', 'option');
      li.textContent = name;
      li.addEventListener('click', () => {
        button.textContent = name;
        list.remove();
      });
      list.append(li);
    }
    document.body.append(list);
    button.setAttribute('aria-controls', list.id);
  });
}

function addPill(containerId: string, text: string): void {
  const list = document.querySelector(`#${containerId} [data-automation-id="selectedItemList"]`)!;
  const pill = document.createElement('div');
  pill.setAttribute('role', 'option');
  pill.setAttribute('data-automation-id', 'selectedItem');
  pill.innerHTML = `<div data-automation-id="DELETE_charm"></div><p data-automation-id="promptOption">${text}</p>`;
  list.append(pill);
}

function promptPopup(containerId: string): HTMLElement {
  const existing = document.querySelector<HTMLElement>(
    `[data-automation-id="responsiveMonikerPrompt"][data-associated-widget="${containerId}"]`,
  );
  if (existing) return existing;
  const popup = document.createElement('div');
  popup.setAttribute('data-automation-id', 'responsiveMonikerPrompt');
  popup.setAttribute('data-associated-widget', containerId);
  popup.innerHTML = '<div data-automation-id="activeListContainer" role="listbox"></div>';
  document.body.append(popup);
  return popup;
}

function showNoItems(containerId: string): void {
  promptPopup(containerId).querySelector('[role="listbox"]')!.innerHTML =
    '<div id="menuItem-" role="option" aria-label="No Items."><div data-automation-id="promptLeafNode"><div data-automation-id="promptOption">No Items.</div></div></div>';
}

function installSearchPrompt(
  containerId: string,
  inputId: string,
  results: string[],
  delayMs = 0,
): void {
  const search = input(inputId);
  search.addEventListener('keyup', (e) => {
    if (e.key !== 'Enter' || !search.value) return;
    if (results.length === 1) {
      addPill(containerId, results[0]!);
      search.value = '';
      return;
    }
    const popup = promptPopup(containerId);
    const list = popup.querySelector('[role="listbox"]')!;
    list.replaceChildren();
    setTimeout(() => {
      if (results.length === 0) {
        showNoItems(containerId);
        return;
      }
      for (const text of results) {
        const option = document.createElement('div');
        option.setAttribute('role', 'option');
        option.innerHTML = `<div data-automation-id="promptLeafNode"><input type="radio" data-automation-id="radioBtn" /></div><div data-automation-id="promptOption">${text}</div>`;
        option.querySelector('[data-automation-id="promptOption"]')!.addEventListener('click', () => {
          addPill(containerId, text);
          search.value = '';
          popup.remove();
        });
        list.append(option);
      }
    }, delayMs);
  });
}

function sourceAnswer(): SiteAnswer {
  const answers = workdayAdapter.siteAnswers!(document);
  expect(answers).toHaveLength(1);
  return answers[0]!;
}

function sourcePills(): string[] {
  return Array.from(
    document.querySelectorAll('#ms-source [data-automation-id="selectedItem"]'),
  ).map((el) => (el.textContent ?? '').trim());
}

describe('workday My Information page (formField wrappers)', () => {
  beforeEach(() => {
    loadFixture();
  });

  it('keys each control off its formField wrapper name', () => {
    const fields = workdayAdapter.detectFields(document);
    const kinds = Object.fromEntries(fields.map((f) => [f.el.id, [f.kind, f.widget ?? 'native']]));
    expect(kinds).toEqual({
      'country--country': ['country', 'virtualizedDropdown'],
      'name--legalName--firstName': ['firstName', 'native'],
      'name--legalName--lastName': ['lastName', 'native'],
      'address--addressLine1': ['addressLine1', 'native'],
      'address--addressLine2': ['addressLine2', 'native'],
      'address--city': ['city', 'native'],
      'address--countryRegion': ['region', 'virtualizedDropdown'],
      'address--postalCode': ['postalCode', 'native'],
      'phoneNumber--countryPhoneCode': ['phoneCountry', 'searchPrompt'],
      'phoneNumber--phoneNumber': ['phoneNational', 'native'],
    });
  });

  it('does not read the SMS opt-in checkbox as a phone field', () => {
    expect(workdayAdapter.detectFields(document).map((f) => f.el.id)).not.toContain('phone-sms-opt-in');
  });

  it('keys the wizard step off its page container so the pill re-arms on Save and Continue', () => {
    expect(workdayAdapter.pageKey!(document)).toBe('applyFlowMyInfoPage');
    document.querySelector('[data-automation-id="applyFlowMyInfoPage"]')!
      .setAttribute('data-automation-id', 'applyFlowMyExpPage');
    expect(workdayAdapter.pageKey!(document)).toBe('applyFlowMyExpPage');
  });

  it('keeps middle name, county, extension and How did you hear away from the AI fallback too', () => {
    const { unclassified } = workdayAdapter.detectAll!(document);
    const ids = unclassified.map((u) => u.el.id);
    for (const id of [
      'name--legalName--middleName',
      'address--regionSubdivision1',
      'phoneNumber--extension',
      'source--source',
      'name--legalName--title',
      'name--legalName--social',
      'name--preferredCheck',
      'phoneNumber--phoneType',
    ]) {
      expect(ids).not.toContain(id);
    }
  });

  it('picks Mobile for a Phone Device Type the site left unpicked, without asking the AI', async () => {
    const phoneType = document.getElementById('phoneNumber--phoneType')!;
    phoneType.textContent = 'Select One';
    installListbox('phoneNumber--phoneType', ['Select One', 'Fax', 'Landline', 'Mobile', 'Pager']);
    const answer = workdayAdapter.siteAnswers!(document).find((a) => a.field.kind === 'phoneType')!;
    const action = await fillSiteAnswer(answer, { forceOverwrite: false, suppressFlash: true });
    expect(action).toMatchObject({ status: 'filled', note: 'picked "Mobile"' });
    expect(phoneType.textContent).toBe('Mobile');
    expect(workdayAdapter.detectAll!(document).unclassified.map((u) => u.el)).not.toContain(phoneType);
  });

  it('leaves a Phone Device Type the site already picked alone', () => {
    expect(workdayAdapter.siteAnswers!(document).map((a) => a.field.kind)).not.toContain('phoneType');
  });

  it('hands a custom search picker to the AI as a search, not as a text box', () => {
    document
      .querySelector('[data-automation-id="formField-source"]')!
      .setAttribute('data-automation-id', 'formField-3e82bdec28fd01a409e3cf270f110316');
    const question = workdayAdapter
      .detectAll!(document)
      .unclassified.find((u) => u.el === input('source--source'));
    expect(question).toEqual({
      el: input('source--source'),
      label: 'How Did You Hear About Us?*',
      fieldType: 'combobox',
      widget: 'searchPrompt',
    });
  });

  it('retries a How did you hear default the search could not find as an AI search', () => {
    expect(unclassifiedFromDetected(sourceAnswer().field)).toMatchObject({
      fieldType: 'combobox',
      widget: 'searchPrompt',
    });
  });

  it('sends the previously employed question to the AI fallback with its Yes and No options', () => {
    const { unclassified } = workdayAdapter.detectAll!(document);
    const question = unclassified.find((u) => u.el.id === 'previousWorker-yes');
    expect(question).toMatchObject({
      fieldType: 'radio',
      label: expect.stringMatching(/^Have you previously been employed by Globex\?/),
      options: ['Yes', 'No'],
    });
    expect(workdayAdapter.detectFields(document).map((f) => f.el.id)).not.toContain('previousWorker-yes');
  });

  it('answers a Yes/No radio question from the site defaults when its label matches one', async () => {
    document.querySelector('#radio-label1 span')!.textContent = 'Are you at least 18 years of age?*';
    const answer = workdayAdapter.siteAnswers!(document).find((a) => a.field.kind === 'screening')!;
    const action = await fillSiteAnswer(answer, { forceOverwrite: false, suppressFlash: true });
    expect(action.status).toBe('filled');
    expect(input('previousWorker-yes').checked).toBe(true);
    expect(workdayAdapter.detectAll!(document).unclassified.map((u) => u.el.id)).not.toContain('previousWorker-yes');
  });

  it('fills the page without the dial code and without touching the fields it leaves blank', async () => {
    installStateListbox();
    const actions = [];
    for (const field of workdayAdapter.detectFields(document)) {
      actions.push(
        await fillDetectedField(field, valueForField(PROFILE, field.kind, field.label), {
          forceOverwrite: false,
          suppressFlash: true,
        }),
      );
    }

    expect(input('name--legalName--firstName').value).toBe('Jordan');
    expect(input('name--legalName--lastName').value).toBe('Rivera');
    expect(input('phoneNumber--phoneNumber').value).toBe('212-555-0142');
    expect(input('address--city').value).toBe('Albany');
    expect(document.getElementById('address--countryRegion')!.textContent).toBe('New York');

    expect(input('name--legalName--middleName').value).toBe('');
    expect(input('address--regionSubdivision1').value).toBe('');
    expect(input('phoneNumber--extension').value).toBe('');
    expect(input('phoneNumber--countryPhoneCode').value).toBe('');

    const phoneCode = actions.find((a) => a.kind === 'phoneCountry');
    expect(phoneCode).toMatchObject({ status: 'skipped', note: 'already filled' });
  });

  it('answers How did you hear by picking LinkedIn from the search results', async () => {
    installSearchPrompt('ms-source', 'source--source', ['LinkedIn', 'LinkedIn']);
    const action = await fillSiteAnswer(sourceAnswer(), { forceOverwrite: false, suppressFlash: true });
    expect(action).toMatchObject({ status: 'filled', note: 'picked "LinkedIn"' });
    expect(sourcePills()).toEqual(['LinkedIn']);
    expect(input('source--source').value).toBe('');
  });

  it('accepts the pick Workday makes when the search has a single result', async () => {
    installSearchPrompt('ms-source', 'source--source', ['LinkedIn']);
    const action = await fillSiteAnswer(sourceAnswer(), { forceOverwrite: false, suppressFlash: true });
    expect(action).toMatchObject({ status: 'filled', note: 'the search picked "LinkedIn"' });
    expect(sourcePills()).toEqual(['LinkedIn']);
  });

  it('clears the search and skips when no result matches', async () => {
    installSearchPrompt('ms-source', 'source--source', ['Indeed', 'Glassdoor']);
    const action = await fillSiteAnswer(sourceAnswer(), { forceOverwrite: false, suppressFlash: true });
    expect(action.status).toBe('skipped');
    expect(sourcePills()).toEqual([]);
    expect(input('source--source').value).toBe('');
  });

  it('stops waiting as soon as Workday answers No Items.', async () => {
    installSearchPrompt('ms-source', 'source--source', []);
    const started = Date.now();
    const action = await fillSiteAnswer(sourceAnswer(), { forceOverwrite: false, suppressFlash: true });
    expect(action).toMatchObject({ status: 'skipped', note: 'no results for "LinkedIn"' });
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('ignores the No Items. left over from an earlier search and waits for the new results', async () => {
    showNoItems('ms-source');
    installSearchPrompt('ms-source', 'source--source', ['LinkedIn', 'LinkedIn'], 200);
    const action = await fillSiteAnswer(sourceAnswer(), { forceOverwrite: false, suppressFlash: true });
    expect(action).toMatchObject({ status: 'filled', note: 'picked "LinkedIn"' });
    expect(sourcePills()).toEqual(['LinkedIn']);
  });

  it('leaves How did you hear alone when it already shows a choice', async () => {
    addPill('ms-source', 'Indeed');
    installSearchPrompt('ms-source', 'source--source', ['LinkedIn', 'LinkedIn']);
    const action = await fillSiteAnswer(sourceAnswer(), { forceOverwrite: false, suppressFlash: true });
    expect(action).toMatchObject({ status: 'skipped', note: 'already filled' });
    expect(sourcePills()).toEqual(['Indeed']);
  });
});
