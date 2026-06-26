import { describe, expect, it, beforeEach } from 'vitest';
import {
  isCompliancePattern,
  findUnclassifiedFields,
  unclassifiedFromDetected,
} from '@/adapters/_shared';
import { genericAdapter } from '@/adapters/generic';
import { ashbyAdapter } from '@/adapters/ashby';
import { buildClassifyPrompt, parseClassifyResponse } from '@/ai/client';
import { resolveAiOption } from '@/content/ai-fallback';
import { harvestComboboxOptions, fillCheckboxGroup, fillButtonGroup } from '@/content/filler';
import type { DetectedField } from '@/adapters/types';
import { emptyProfile } from '@/profile/schema';

describe('isCompliancePattern', () => {
  it('flags EEO and immigration variants the broad regex covers', () => {
    const cases = [
      'What is your race?',
      'Race / Ethnicity',
      'Are you Hispanic or Latino?',
      'Disability status',
      'Have you ever served in the military?',
      'Veteran status',
      'Do you require sponsorship?',
      'Will you need a visa?',
      'Are you authorized to work in the US?',
      'work-authorization',
      'H-1B holder?',
      'Are you a US citizen?',
      'Do you hold a green card?',
    ];
    for (const s of cases) {
      expect(isCompliancePattern(s), `should match: ${s}`).toBe(true);
    }
  });

  it('lets neutral questions through', () => {
    const cases = [
      'What is your full name?',
      'Why are you interested in this role?',
      'How did you hear about us?',
      'Address (Please specify City & State)',
    ];
    for (const s of cases) {
      expect(isCompliancePattern(s), `should NOT match: ${s}`).toBe(false);
    }
  });
});

describe('findUnclassifiedFields', () => {
  beforeEach(() => {
    document.documentElement.innerHTML = '<head></head><body></body>';
  });

  it('skips elements already in the classified set', () => {
    document.body.innerHTML = `
      <form>
        <label for="fn">First name</label>
        <input id="fn" name="firstName" type="text" />
        <label for="q1">How did you hear about us?</label>
        <input id="q1" name="hear_about" type="text" />
      </form>
    `;
    const fn = document.getElementById('fn')!;
    const classified = [
      { el: fn, kind: 'firstName' as const, label: 'First name', confidence: 0.99 },
    ];
    const unclassified = findUnclassifiedFields(document, classified);
    const labels = unclassified.map((u) => u.label);
    expect(labels).toContain('How did you hear about us?');
    expect(labels).not.toContain('First name');
  });

  it('groups radio sets into one entry with options', () => {
    document.body.innerHTML = `
      <form>
        <fieldset>
          <label for="favorite-color">Favorite color?</label>
          <input type="radio" id="c-blue" name="color" />
          <label for="c-blue">Blue</label>
          <input type="radio" id="c-green" name="color" />
          <label for="c-green">Green</label>
        </fieldset>
      </form>
    `;
    const unclassified = findUnclassifiedFields(document, []);
    const radios = unclassified.filter((u) => u.fieldType === 'radio');
    expect(radios.length).toBe(1);
    expect(radios[0]?.options).toEqual(['Blue', 'Green']);
  });

  it('captures select options', () => {
    document.body.innerHTML = `
      <form>
        <label for="size">T-shirt size</label>
        <select id="size" name="size">
          <option value="">--</option>
          <option value="s">Small</option>
          <option value="m">Medium</option>
        </select>
      </form>
    `;
    const unclassified = findUnclassifiedFields(document, []);
    const sel = unclassified.find((u) => u.fieldType === 'select');
    expect(sel?.options).toEqual(['--', 'Small', 'Medium']);
  });

  it('skips comboboxes labeled with a generic widget sub-control word', () => {
    document.body.innerHTML = `
      <form>
        <label for="phone">Phone</label>
        <input id="phone" type="tel" name="phone" />
        <div class="flag-dropdown">
          <input id="dial-search" type="text" role="combobox"
                 aria-label="Search" aria-haspopup="listbox" />
        </div>
        <label for="real-q">How many years of experience?</label>
        <input id="real-q" type="text" role="combobox" aria-haspopup="listbox" />
      </form>
    `;
    const unclassified = findUnclassifiedFields(document, []);
    const labels = unclassified.map((u) => u.label);
    expect(labels).not.toContain('Search');
    expect(labels).toContain('How many years of experience?');
  });

  it('claims an <input role="combobox"> before the plain-input walk', () => {
    document.body.innerHTML = `
      <form>
        <label for="country">Country of residence</label>
        <input id="country" type="text" role="combobox" aria-haspopup="listbox" />
      </form>
    `;
    const unclassified = findUnclassifiedFields(document, []);
    const country = unclassified.find((u) => u.el.id === 'country');
    expect(country?.fieldType).toBe('combobox');
    const texts = unclassified.filter((u) => u.fieldType === 'text');
    expect(texts.length).toBe(0);
  });
});

describe('adapter.detectAll() delegation', () => {
  it('generic adapter surfaces both classified and unclassified fields', () => {
    document.body.innerHTML = `
      <form>
        <label for="email">Email</label>
        <input id="email" type="email" />
        <label for="custom">Custom unmapped question</label>
        <input id="custom" type="text" />
      </form>
    `;
    const result = genericAdapter.detectAll!(document);
    expect(result.classified.some((f) => f.kind === 'email')).toBe(true);
    const labels = result.unclassified.map((u) => u.label);
    expect(labels).toContain('Custom unmapped question');
  });

  it('ashby adapter exposes detectAll', () => {
    expect(typeof ashbyAdapter.detectAll).toBe('function');
  });
});
describe('unclassifiedFromDetected', () => {
  beforeEach(() => {
    document.documentElement.innerHTML = '<head></head><body></body>';
  });

  it('extracts options for native <select>', () => {
    document.body.innerHTML = `
      <label for="country">Country</label>
      <select id="country">
        <option value="">--</option>
        <option value="us">United States</option>
        <option value="ca">Canada</option>
      </select>
    `;
    const el = document.getElementById('country') as HTMLSelectElement;
    const u = unclassifiedFromDetected({
      el,
      kind: 'country',
      label: 'Country',
      confidence: 0.85,
    });
    expect(u?.fieldType).toBe('select');
    expect(u?.options).toEqual(['--', 'United States', 'Canada']);
  });

  it('returns textarea fieldType with no options', () => {
    document.body.innerHTML = `
      <label for="why">Why us?</label>
      <textarea id="why"></textarea>
    `;
    const el = document.getElementById('why') as HTMLTextAreaElement;
    const u = unclassifiedFromDetected({
      el,
      kind: 'openEnded',
      label: 'Why us?',
      confidence: 0.5,
    });
    expect(u?.fieldType).toBe('textarea');
    expect(u?.options).toBeUndefined();
  });

  it('collects radio group options from siblings sharing a name', () => {
    document.body.innerHTML = `
      <fieldset>
        <legend>Open to relocation?</legend>
        <input type="radio" name="reloc" id="r-yes" /><label for="r-yes">Yes</label>
        <input type="radio" name="reloc" id="r-no" /><label for="r-no">No</label>
      </fieldset>
    `;
    const first = document.getElementById('r-yes') as HTMLInputElement;
    const u = unclassifiedFromDetected({
      el: first,
      kind: 'willingToRelocate',
      label: 'Open to relocation?',
      confidence: 0.75,
    });
    expect(u?.fieldType).toBe('radio');
    expect(u?.options).toEqual(['Yes', 'No']);
  });

  it('marks virtualizedDropdown widgets as combobox', () => {
    document.body.innerHTML = `
      <div id="trigger" role="combobox">Pick…</div>
    `;
    const el = document.getElementById('trigger') as HTMLElement;
    const u = unclassifiedFromDetected({
      el,
      kind: 'country',
      label: 'Country',
      confidence: 0.85,
      widget: 'virtualizedDropdown',
    });
    expect(u?.fieldType).toBe('combobox');
  });

  it('returns null for checkboxes and file inputs', () => {
    document.body.innerHTML = `
      <input type="checkbox" id="cb" />
      <input type="file" id="f" />
    `;
    const cb = document.getElementById('cb') as HTMLInputElement;
    const f = document.getElementById('f') as HTMLInputElement;
    expect(
      unclassifiedFromDetected({
        el: cb,
        kind: 'authorizedToWorkInUS',
        label: 'Confirm',
        confidence: 0.5,
      }),
    ).toBeNull();
    expect(
      unclassifiedFromDetected({
        el: f,
        kind: 'otherLink',
        label: 'Upload',
        confidence: 0.5,
      }),
    ).toBeNull();
  });

  it('returns null when the label is empty', () => {
    document.body.innerHTML = `<input type="text" id="t" />`;
    const t = document.getElementById('t') as HTMLInputElement;
    expect(
      unclassifiedFromDetected({
        el: t,
        kind: 'firstName',
        label: '',
        confidence: 0.9,
      }),
    ).toBeNull();
  });
});

describe('buildClassifyPrompt', () => {
  it('lists options verbatim for radio fields and instructs the model to pick one', () => {
    const prompt = buildClassifyPrompt(
      {
        question: 'Favorite color?',
        fieldType: 'radio',
        options: ['Blue', 'Green'],
      },
      emptyProfile(),
    );
    expect(prompt.user).toContain('Favorite color?');
    expect(prompt.user).toContain('Available options');
    expect(prompt.user).toContain('- Blue');
    expect(prompt.user).toContain('- Green');
    expect(prompt.user).toMatch(/exact text of one option|verbatim/i);
  });

  it('omits the options block for free-form text fields', () => {
    const prompt = buildClassifyPrompt(
      { question: 'Name?', fieldType: 'text' },
      emptyProfile(),
    );
    expect(prompt.user).not.toContain('Available options');
    expect(prompt.user).toMatch(/single short value/i);
  });

  it('forbids fabrication and instructs SKIP when profile is missing the answer', () => {
    const prompt = buildClassifyPrompt(
      { question: 'Anything', fieldType: 'text' },
      emptyProfile(),
    );
    expect(prompt.system).toMatch(/SKIP/);
    expect(prompt.system).toMatch(/Never fabricate|do not invent|reply SKIP/i);
  });
});
describe('parseClassifyResponse', () => {
  it('returns the first non-empty line', () => {
    expect(parseClassifyResponse('United States\n\nextra commentary')).toBe('United States');
  });

  it('strips surrounding quotes', () => {
    expect(parseClassifyResponse('"United States"')).toBe('United States');
    expect(parseClassifyResponse("'Yes'")).toBe('Yes');
  });

  it('returns null when the model replies SKIP', () => {
    expect(parseClassifyResponse('SKIP')).toBeNull();
    expect(parseClassifyResponse('skip')).toBeNull();
    expect(parseClassifyResponse('  SKIP\nbecause profile lacks it')).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(parseClassifyResponse('')).toBeNull();
    expect(parseClassifyResponse('\n\n  ')).toBeNull();
  });

  it('keeps newlines for textarea field type so multi-paragraph answers survive', () => {
    const multi = 'Para one with some detail.\n\nPara two answering the question.';
    expect(parseClassifyResponse(multi, 'textarea')).toBe(multi);
  });

  it('strips a single pair of wrapping quotes on textareas', () => {
    expect(
      parseClassifyResponse('"line one\nline two"', 'textarea'),
    ).toBe('line one\nline two');
  });

  it('returns null when textarea reply is just SKIP', () => {
    expect(parseClassifyResponse('SKIP', 'textarea')).toBeNull();
    expect(parseClassifyResponse('  skip.  ', 'textarea')).toBeNull();
  });

  it('extracts the option from a multi-line response when options are given', () => {
    const opts = ['Immediately', '1-2 weeks', '1 month', '2+ months'];
    expect(
      parseClassifyResponse(
        "Based on your profile, here's the reasonable answer:\nImmediately",
        'select',
        opts,
      ),
    ).toBe('Immediately');
  });

  it('picks up an option mentioned later in the response (whole-word, single match)', () => {
    const opts = ['Yes', 'No'];
    expect(parseClassifyResponse('I would answer: Yes', 'radio', opts)).toBe('Yes');
  });

  it('still returns a non-option preamble if no option matches anywhere', () => {
    const opts = ['Immediately', '1 month'];
    expect(
      parseClassifyResponse('No information given in the profile.', 'select', opts),
    ).toBe('No information given in the profile.');
  });
});
describe('buildClassifyPrompt — preference mode', () => {
  it('relaxes SKIP for option-bound preference questions', () => {
    const prompt = buildClassifyPrompt(
      {
        question: 'When is the earliest you would want to start?',
        fieldType: 'select',
        options: ['Immediately', '1-2 weeks', '1 month', '2+ months'],
      },
      emptyProfile(),
      { mode: 'preference' },
    );
    expect(prompt.system).toMatch(/reasonable|sensible default|most plausible|standard candidate/i);
    expect(prompt.system).toMatch(/fabricate/i);
    expect(prompt.user).toMatch(/exact text of one option/i);
  });

  it('strict mode keeps the original SKIP-on-silent instruction', () => {
    const prompt = buildClassifyPrompt(
      {
        question: 'Anything',
        fieldType: 'text',
      },
      emptyProfile(),
      { mode: 'strict' },
    );
    expect(prompt.system).toMatch(/If the profile does not contain enough information/i);
  });

  it('preference mode options block omits the SKIP escape hatch', () => {
    const prompt = buildClassifyPrompt(
      {
        question: 'Start date?',
        fieldType: 'select',
        options: ['Immediately', '1 month'],
      },
      emptyProfile(),
      { mode: 'preference' },
    );
    expect(prompt.user).toMatch(/MUST return one of these verbatim\)/);
    expect(prompt.user).not.toMatch(/or "SKIP"/);
    const hint = prompt.user.split('\n').pop() ?? '';
    expect(hint).not.toMatch(/reply with the single word: SKIP/);
  });

  it('strict mode options block keeps the SKIP escape hatch', () => {
    const prompt = buildClassifyPrompt(
      {
        question: 'Start date?',
        fieldType: 'select',
        options: ['Immediately', '1 month'],
      },
      emptyProfile(),
      { mode: 'strict' },
    );
    expect(prompt.user).toMatch(/or "SKIP"/);
  });
});

describe('harvestComboboxOptions', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  function installLazyListbox(
    trigger: HTMLElement,
    optionTexts: string[],
  ): void {
    trigger.addEventListener('mousedown', () => {
      if (document.querySelector('[role="listbox"]')) return;
      const lb = document.createElement('div');
      lb.setAttribute('role', 'listbox');
      for (const t of optionTexts) {
        const opt = document.createElement('div');
        opt.setAttribute('role', 'option');
        opt.textContent = t;
        lb.appendChild(opt);
      }
      document.body.appendChild(lb);
    });
    trigger.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key !== 'Escape') return;
      document.querySelector('[role="listbox"]')?.remove();
    });
  }

  it('opens the popup, reads option text, then closes via Escape', async () => {
    document.body.innerHTML =
      `<div role="combobox" id="t" aria-haspopup="listbox" tabindex="0"></div>`;
    const trigger = document.getElementById('t') as HTMLElement;
    installLazyListbox(trigger, ['Yes', 'No']);

    const out = await harvestComboboxOptions(trigger, { timeoutMs: 200 });
    expect(out).toEqual(['Yes', 'No']);
    expect(document.querySelector('[role="listbox"]')).toBeNull();
  });

  it('skips aria-disabled options and dedupes', async () => {
    document.body.innerHTML =
      `<div role="combobox" id="t" aria-haspopup="listbox" tabindex="0"></div>`;
    const trigger = document.getElementById('t') as HTMLElement;
    trigger.addEventListener('mousedown', () => {
      if (document.querySelector('[role="listbox"]')) return;
      document.body.insertAdjacentHTML(
        'beforeend',
        `<div role="listbox">
           <div role="option" aria-disabled="true">Select...</div>
           <div role="option">Yes</div>
           <div role="option">Yes</div>
           <div role="option">No</div>
         </div>`,
      );
    });
    const out = await harvestComboboxOptions(trigger, { timeoutMs: 200 });
    expect(out).toEqual(['Yes', 'No']);
  });

  it('caps the result at maxOptions for huge virtualised lists', async () => {
    document.body.innerHTML =
      `<div role="combobox" id="t" aria-haspopup="listbox" tabindex="0"></div>`;
    const trigger = document.getElementById('t') as HTMLElement;
    const many = Array.from({ length: 120 }, (_, i) => `Country ${i}`);
    installLazyListbox(trigger, many);

    const out = await harvestComboboxOptions(trigger, {
      timeoutMs: 200,
      maxOptions: 50,
    });
    expect(out.length).toBe(50);
    expect(out[0]).toBe('Country 0');
    expect(out[49]).toBe('Country 49');
  });

  it('returns an empty list when the popup never appears', async () => {
    document.body.innerHTML =
      `<div role="combobox" id="t" aria-haspopup="listbox" tabindex="0"></div>`;
    const trigger = document.getElementById('t') as HTMLElement;
    const out = await harvestComboboxOptions(trigger, { timeoutMs: 80 });
    expect(out).toEqual([]);
  });

  it('opens via ArrowDown when only the input is the trigger', async () => {
    document.body.innerHTML =
      `<input id="t" role="combobox" aria-haspopup="true" tabindex="0" />`;
    const trigger = document.getElementById('t') as HTMLElement;
    trigger.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key !== 'ArrowDown') return;
      if (document.querySelector('[role="listbox"]')) return;
      document.body.insertAdjacentHTML(
        'beforeend',
        `<div role="listbox">
           <div role="option">1-2 years</div>
           <div role="option">3-5 years</div>
         </div>`,
      );
    });
    const out = await harvestComboboxOptions(trigger, { timeoutMs: 200 });
    expect(out).toEqual(['1-2 years', '3-5 years']);
  });

  it('does not read a stale listbox left over from a previous combobox', async () => {
    document.body.innerHTML = `
      <input id="t" role="combobox" aria-haspopup="true" tabindex="0" />
      <div role="listbox" id="stale">
        <div role="option">Afghanistan+93</div>
        <div role="option">United States+1</div>
      </div>
    `;
    const trigger = document.getElementById('t') as HTMLElement;
    trigger.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key !== 'ArrowDown') return;
      document.body.insertAdjacentHTML(
        'beforeend',
        `<div role="listbox" id="fresh">
           <div role="option">1-2 years</div>
           <div role="option">3-5 years</div>
         </div>`,
      );
    });
    const out = await harvestComboboxOptions(trigger, { timeoutMs: 200 });
    expect(out).toEqual(['1-2 years', '3-5 years']);
  });

  it('returns [] when ONLY a stale listbox is present and no new one opens', async () => {
    document.body.innerHTML = `
      <input id="t" role="combobox" aria-haspopup="true" tabindex="0" />
      <div role="listbox" id="stale">
        <div role="option">Stale Option</div>
      </div>
    `;
    const trigger = document.getElementById('t') as HTMLElement;
    const out = await harvestComboboxOptions(trigger, { timeoutMs: 80 });
    expect(out).toEqual([]);
  });
});

describe('resolveAiOption', () => {
  const yesNo = ['Yes', 'No'];
  const race = [
    'Hispanic or Latino',
    'White (Not Hispanic or Latino)',
    'Asian (Not Hispanic or Latino)',
    'Decline to self-identify',
  ];

  it('exact match (case-insensitive)', () => {
    expect(resolveAiOption('Yes', yesNo)).toBe('Yes');
    expect(resolveAiOption('yes', yesNo)).toBe('Yes');
    expect(resolveAiOption('Hispanic or Latino', race)).toBe('Hispanic or Latino');
  });

  it('extracts an option from an AI response with extra commentary', () => {
    expect(
      resolveAiOption('Hispanic or Latino - based on the profile', race),
    ).toBe('Hispanic or Latino');
  });

  it('returns null when the AI response ambiguously contains multiple options', () => {
    expect(
      resolveAiOption(
        'Not Hispanic or Latino, but Asian (Not Hispanic or Latino)',
        race,
      ),
    ).toBeNull();
  });

  it('prefix-matches a single option (AI returns "Asian", option is verbose)', () => {
    expect(resolveAiOption('Asian', race)).toBe('Asian (Not Hispanic or Latino)');
  });

  it('returns null when nothing matches', () => {
    expect(resolveAiOption('Klingon', race)).toBeNull();
    expect(resolveAiOption('', yesNo)).toBeNull();
  });
});

describe('fillCheckboxGroup', () => {
  beforeEach(() => {
    document.documentElement.innerHTML = '<head></head><body></body>';
  });

  it('ticks only the chosen options in the group', () => {
    document.body.innerHTML = `
      <form>
        <fieldset>
          <label for="t">Which of these have you used?</label>
          <input type="checkbox" id="t-react" name="t" /><label for="t-react">React</label>
          <input type="checkbox" id="t-vue" name="t" /><label for="t-vue">Vue</label>
          <input type="checkbox" id="t-svelte" name="t" /><label for="t-svelte">Svelte</label>
        </fieldset>
      </form>
    `;
    const rep = document.getElementById('t-react') as HTMLInputElement;
    const action = fillCheckboxGroup(
      rep,
      ['React', 'Svelte'],
      { forceOverwrite: true, suppressFlash: true },
      { label: 'Which of these have you used?', kind: 'openEnded' },
    );
    expect(action.status).toBe('filled');
    expect((document.getElementById('t-react') as HTMLInputElement).checked).toBe(true);
    expect((document.getElementById('t-svelte') as HTMLInputElement).checked).toBe(true);
    expect((document.getElementById('t-vue') as HTMLInputElement).checked).toBe(false);
  });
});

describe('fillButtonGroup', () => {
  beforeEach(() => {
    document.documentElement.innerHTML = '<head></head><body></body>';
  });

  function group(html: string): { field: DetectedField; clicked: string[] } {
    document.body.innerHTML = html;
    const container = document.querySelector<HTMLElement>('.opts')!;
    const clicked: string[] = [];
    for (const b of Array.from(container.querySelectorAll('button'))) {
      b.addEventListener('click', () => clicked.push((b.textContent ?? '').trim()));
    }
    const field: DetectedField = {
      el: container,
      kind: 'authorizedToWorkInUS',
      label: 'Are you authorized to work in the US?',
      confidence: 1,
      widget: 'buttonGroup',
    };
    return { field, clicked };
  }

  const yesno = `
    <div class="opts">
      <button>Yes</button>
      <button>No</button>
      <input type="checkbox" tabindex="-1" name="q" />
    </div>
  `;

  it('clicks the button matching the value', () => {
    const { field, clicked } = group(yesno);
    const action = fillButtonGroup(field, 'No', { forceOverwrite: false, suppressFlash: true });
    expect(action.status).toBe('filled');
    expect(clicked).toEqual(['No']);
  });
});
