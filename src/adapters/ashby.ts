import type { PlatformAdapter, DetectedField, FieldKind, DetectionResult, UnclassifiedField } from './types';
import {
  classifyByHeuristics,
  collectContext,
  fromKeywords,
  isFillable,
  attachResumeViaSlot,
  findResumeInput,
  normalize,
  textOf,
  bestLabel,
  isConsentCheckboxLabel,
  findUnclassifiedFields,
  clipJobDescription,
  pickJobDescriptionByCss,
  hasSubmissionConfirmText,
} from './_shared';

const FIELD_ENTRY_SELECTOR = '[data-field-entry-id], [data-testid="FieldEntry"]';
const FIELD_LABEL_SELECTOR =
  '.ashby-application-form-question-title, [data-testid="FieldLabel"]';

export const ashbyAdapter: PlatformAdapter = {
  id: 'ashby',
  name: 'Ashby',
  matches: (url, doc) => {
    if (/(^|\.)ashbyhq\.com$/.test(url.hostname)) return true;
    return !!doc.querySelector(`${FIELD_ENTRY_SELECTOR}, ${FIELD_LABEL_SELECTOR}`);
  },
  detectFields,
  detectAll,
  fillResume,
  getJobDescription,
  detectSubmissionConfirmed,
};

function detectSubmissionConfirmed(doc: Document, _url: URL): boolean {
  if (
    doc.querySelector(
      '[data-testid="application-confirmation"], [data-testid="ApplicationConfirmation"], [data-testid="submitted-application"]',
    )
  ) {
    return true;
  }
  const formGone = !doc.querySelector(FIELD_ENTRY_SELECTOR);
  return formGone && hasSubmissionConfirmText(doc);
}

function getJobDescription(doc: Document): string {
  const byCss = pickJobDescriptionByCss(doc, [
    '[data-testid="JobPostingDescription"]',
    '[data-testid="JobPostingPage"]',
    'main',
  ]);
  if (byCss) return byCss;
  if (doc.body) return clipJobDescription(doc.body.textContent ?? '');
  return '';
}

function detectFields(root: Document): DetectedField[] {
  const out: DetectedField[] = [];
  const seen = new WeakSet<HTMLElement>();

  const entries = root.querySelectorAll<HTMLElement>(FIELD_ENTRY_SELECTOR);
  for (const entry of Array.from(entries)) {
    const labelEl = entry.querySelector(FIELD_LABEL_SELECTOR);
    const labelText = labelEl ? textOf(labelEl) : '';
    if (!labelText) continue;
    const haystack = normalize(labelText);
    const hit = fromKeywords(haystack);

    const buttonGroup = detectButtonGroup(entry);
    if (buttonGroup) {
      claimButtonGroup(entry, buttonGroup, seen);
      if (hit) {
        out.push({
          el: buttonGroup.container,
          kind: hit.kind,
          label: labelText,
          confidence: Math.min(1, hit.confidence + 0.1),
          widget: 'buttonGroup',
        });
      }
      continue;
    }

    const radios = entry.querySelectorAll<HTMLInputElement>('input[type="radio"]');
    if (radios.length > 0) {
      const groupReps = new Map<string, HTMLInputElement>();
      for (const r of Array.from(radios)) {
        if (!r.name) continue;
        if (!groupReps.has(r.name)) groupReps.set(r.name, r);
      }
      if (hit) {
        for (const rep of groupReps.values()) {
          if (!isFillable(rep)) continue;
          out.push({
            el: rep,
            kind: hit.kind,
            label: labelText,
            confidence: Math.min(1, hit.confidence + 0.1),
          });
        }
      }
      for (const r of Array.from(radios)) seen.add(r);
    }

    const inputs = entry.querySelectorAll<HTMLElement>('input, select, textarea');
    for (const el of Array.from(inputs)) {
      if (!isFillable(el)) continue;
      if (seen.has(el)) continue;

      let kind: FieldKind | null = null;
      let confidence = 0;
      if (hit) {
        kind = hit.kind;
        confidence = Math.min(1, hit.confidence + 0.1);
      } else if (el instanceof HTMLTextAreaElement) {
        kind = /cover\s*letter/i.test(haystack) ? 'coverLetter' : 'openEnded';
        confidence = 0.7;
      } else if (el instanceof HTMLInputElement) {
        if (el.type === 'email') {
          kind = 'email';
          confidence = 0.95;
        } else if (el.type === 'tel') {
          kind = 'phone';
          confidence = 0.95;
        } else if (el.type === 'text' && haystack === 'name') {
          kind = 'fullName';
          confidence = 0.8;
        }
      }

      if (kind) {
        out.push({ el, kind, label: labelText, confidence });
        seen.add(el);
      }
    }
  }

  for (const el of Array.from(root.querySelectorAll<HTMLElement>('input, select, textarea'))) {
    if (seen.has(el)) continue;
    if (!isFillable(el)) continue;
    const ctx = collectContext(el);
    const classified = classifyByHeuristics(el, ctx);
    if (!classified) continue;
    out.push({ el, kind: classified.kind, label: ctx.label, confidence: classified.confidence });
  }

  return out;
}

function detectAll(root: Document): DetectionResult {
  const classified = detectFields(root);
  const claimed = new WeakSet<HTMLElement>();
  const claimedRadioNames = new Set<string>();
  for (const f of classified) {
    claimed.add(f.el);
    if (f.el instanceof HTMLInputElement && f.el.type === 'radio' && f.el.name) {
      claimedRadioNames.add(f.el.name);
    }
  }

  const unclassified: UnclassifiedField[] = [];
  const seen = new WeakSet<HTMLElement>();
  const push = (u: UnclassifiedField): void => {
    if (!(u.el instanceof HTMLElement)) return;
    if (seen.has(u.el)) return;
    seen.add(u.el);
    unclassified.push(u);
  };

  for (const entry of Array.from(root.querySelectorAll<HTMLElement>(FIELD_ENTRY_SELECTOR))) {
    const labelEl = entry.querySelector(FIELD_LABEL_SELECTOR);
    const question = labelEl ? textOf(labelEl) : '';
    if (!question) continue;

    const buttonGroup = detectButtonGroup(entry);
    if (buttonGroup) {
      if (!claimed.has(buttonGroup.container)) {
        push({
          el: buttonGroup.container,
          label: question,
          fieldType: 'buttongroup',
          options: buttonGroup.options,
        });
      }
      continue;
    }

    const radios = Array.from(
      entry.querySelectorAll<HTMLInputElement>('input[type="radio"]'),
    ).filter(isFillable);
    if (radios.length > 0) {
      const rep = radios.find((r) => !r.name || !claimedRadioNames.has(r.name));
      if (rep && !claimed.has(rep)) {
        const options = optionLabelsOf(radios);
        push({ el: rep, label: question, fieldType: 'radio', options });
      }
      continue;
    }

    const checkboxes = Array.from(
      entry.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
    ).filter(isFillable);
    if (checkboxes.length > 0) {
      const unclaimed = checkboxes.filter((c) => !claimed.has(c));
      const options = optionLabelsOf(checkboxes);
      if (
        unclaimed.length >= 2 &&
        options.length >= 2 &&
        !isConsentCheckboxLabel(question)
      ) {
        push({ el: unclaimed[0]!, label: question, fieldType: 'checkbox', options });
      }
      continue;
    }

    const combo = entry.querySelector<HTMLElement>(
      '[role="combobox"], [aria-haspopup="listbox"]',
    );
    if (combo && !claimed.has(combo)) {
      push({ el: combo, label: question, fieldType: 'combobox' });
      continue;
    }

    const select = entry.querySelector<HTMLSelectElement>('select');
    if (select && !claimed.has(select) && isFillable(select)) {
      const options = Array.from(select.options)
        .map((o) => (o.textContent ?? '').trim())
        .filter((t) => t.length > 0);
      push({ el: select, label: question, fieldType: 'select', options });
      continue;
    }

    const textarea = entry.querySelector<HTMLTextAreaElement>('textarea');
    if (textarea && !claimed.has(textarea) && isFillable(textarea)) {
      push({ el: textarea, label: question, fieldType: 'textarea' });
      continue;
    }

    const input = entry.querySelector<HTMLInputElement>('input');
    if (input && !claimed.has(input) && isFillable(input)) {
      const skip = new Set([
        'email', 'tel', 'url', 'number', 'date', 'password', 'file', 'hidden',
      ]);
      if (!skip.has(input.type)) {
        push({ el: input, label: question, fieldType: 'text' });
      }
    }
  }

  for (const u of findUnclassifiedFields(root, classified)) push(u);

  return { classified, unclassified };
}

function optionLabelsOf(inputs: HTMLInputElement[]): string[] {
  return inputs.map((i) => bestLabel(i).trim()).filter((s) => s.length > 0);
}

function detectButtonGroup(
  entry: HTMLElement,
): { container: HTMLElement; options: string[] } | null {
  const mirror = entry.querySelector<HTMLInputElement>(
    'input[type="checkbox"], input[type="radio"]',
  );
  if (!mirror || !mirror.parentElement) return null;
  const container = mirror.parentElement;
  const options: string[] = [];
  for (const b of Array.from(container.querySelectorAll<HTMLButtonElement>('button'))) {
    const t = textOf(b);
    if (t && !options.includes(t)) options.push(t);
  }
  if (options.length < 2) return null;
  return { container, options };
}

function claimButtonGroup(
  entry: HTMLElement,
  group: { container: HTMLElement },
  seen: WeakSet<HTMLElement>,
): void {
  for (const b of Array.from(group.container.querySelectorAll<HTMLElement>('button'))) {
    seen.add(b);
  }
  const mirror = entry.querySelector<HTMLInputElement>(
    'input[type="checkbox"], input[type="radio"]',
  );
  if (mirror) seen.add(mirror);
}

async function fillResume(file: File, root: Document): Promise<boolean> {
  return attachResumeViaSlot(file, root, (d) => {
    const entries = d.querySelectorAll<HTMLElement>(FIELD_ENTRY_SELECTOR);
    for (const entry of Array.from(entries)) {
      const labelEl = entry.querySelector(FIELD_LABEL_SELECTOR);
      const label = labelEl ? textOf(labelEl) : '';
      if (/\b(resume|résumé|cv|curriculum)\b/i.test(label)) {
        const input = entry.querySelector<HTMLInputElement>('input[type="file"]');
        if (input && !input.disabled) return input;
      }
    }
    return findResumeInput(d);
  });
}
