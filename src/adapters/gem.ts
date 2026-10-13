import type {
  PlatformAdapter,
  DetectedField,
  DetectionResult,
  UnclassifiedField,
} from './types';
import {
  attachResumeViaSlot,
  bestLabel,
  clipJobDescription,
  findResumeInput,
  fromKeywords,
  hasSubmissionConfirmText,
  isConsentCheckboxLabel,
  isFillable,
  normalize,
  pickJobDescriptionByCss,
  RESUME_HINTS,
  textOf,
  type Classification,
} from './_shared';

const GEM_HOST = 'jobs.gem.com';
const POWERED_BY_GEM_SELECTOR = 'img[alt="Gem Logo"]';
const CONTROL_SELECTOR = 'input, textarea, select, button';
const TEXT_INPUT_TYPES: ReadonlySet<string> = new Set(['text', 'email', 'tel', 'url', 'number']);
const BLOCK_MAX_DEPTH = 8;
const GEM_CONFIRMATION_RE = /\byour application for .+ has been received\b/i;

type QuestionBlock = { el: HTMLElement; title: string };

export const gemAdapter: PlatformAdapter = {
  id: 'gem',
  name: 'Gem',
  matches: (url, doc) =>
    url.hostname === GEM_HOST || !!doc.querySelector(POWERED_BY_GEM_SELECTOR),
  detectFields: (root) => detectAll(root).classified,
  detectAll,
  fillResume,
  getJobDescription,
  detectSubmissionConfirmed,
};

function detectAll(root: Document): DetectionResult {
  const classified: DetectedField[] = [];
  const unclassified: UnclassifiedField[] = [];
  const claimed = new Set<HTMLElement>();

  const claim = (control: HTMLElement): QuestionBlock | null => {
    const block = questionBlock(control);
    if (!block || claimed.has(block.el)) return null;
    claimed.add(block.el);
    return block;
  };

  for (const control of Array.from(root.querySelectorAll<HTMLElement>('input, textarea, button'))) {
    if (control instanceof HTMLInputElement) {
      if (control.type === 'radio' || control.type === 'checkbox') {
        const block = claim(control);
        if (block) addChoiceGroup(block, control.type, classified, unclassified);
        continue;
      }
      if (!TEXT_INPUT_TYPES.has(control.type) || !isFillable(control)) continue;
      const block = claim(control);
      if (!block) continue;
      const hit = textKind(block.title);
      if (hit) {
        classified.push({ el: control, kind: hit.kind, label: block.title, confidence: hit.confidence });
      } else {
        unclassified.push({ el: control, label: block.title, fieldType: 'text' });
      }
      continue;
    }

    if (control instanceof HTMLTextAreaElement) {
      if (!isFillable(control)) continue;
      const block = claim(control);
      if (!block) continue;
      classified.push({
        el: control,
        kind: /cover\s*letter/i.test(block.title) ? 'coverLetter' : 'openEnded',
        label: block.title,
        confidence: 0.7,
      });
      continue;
    }

    if (control instanceof HTMLButtonElement && isMenuTrigger(control)) {
      const block = claim(control);
      if (!block) continue;
      const hit = fromKeywords(plainTitle(block.title));
      if (hit) {
        classified.push({
          el: control,
          kind: hit.kind,
          label: block.title,
          confidence: hit.confidence,
          widget: 'menuButton',
        });
      } else {
        unclassified.push({
          el: control,
          label: block.title,
          fieldType: 'combobox',
          widget: 'menuButton',
        });
      }
    }
  }

  return { classified, unclassified };
}

function addChoiceGroup(
  block: QuestionBlock,
  type: 'radio' | 'checkbox',
  classified: DetectedField[],
  unclassified: UnclassifiedField[],
): void {
  const members = Array.from(
    block.el.querySelectorAll<HTMLInputElement>(`input[type="${type}"]`),
  ).filter((m) => !m.disabled);
  const rep = members[0];
  if (!rep) return;
  const options = members.map((m) => bestLabel(m).trim()).filter((s) => s.length > 0);

  if (type === 'checkbox') {
    if (options.length >= 2 && !isConsentCheckboxLabel(block.title)) {
      unclassified.push({ el: rep, label: block.title, fieldType: 'checkbox', options });
    }
    return;
  }

  const hit = fromKeywords(plainTitle(block.title));
  if (hit) {
    classified.push({ el: rep, kind: hit.kind, label: block.title, confidence: hit.confidence });
  } else {
    unclassified.push({ el: rep, label: block.title, fieldType: 'radio', options });
  }
}

function questionBlock(control: HTMLElement): QuestionBlock | null {
  let child: HTMLElement = control;
  for (let depth = 0; depth < BLOCK_MAX_DEPTH; depth++) {
    const parent = child.parentElement;
    if (!parent) return null;
    const first = parent.firstElementChild;
    if (first instanceof HTMLElement && !holdsControl(first)) {
      const title = textOf(first);
      if (title) return { el: parent, title };
    }
    child = parent;
  }
  return null;
}

function holdsControl(el: HTMLElement): boolean {
  return el.matches(CONTROL_SELECTOR) || !!el.querySelector(CONTROL_SELECTOR);
}

function isMenuTrigger(button: HTMLButtonElement): boolean {
  if (button.type !== 'button' || button.disabled || button.hasAttribute('aria-label')) {
    return false;
  }
  const block = questionBlock(button);
  if (!block) return false;
  return (
    block.el.querySelectorAll('button').length === 1 &&
    !block.el.querySelector('input, textarea, select')
  );
}

function plainTitle(title: string): string {
  return normalize(title.replace(/\s*\*\s*$/, ''));
}

function textKind(title: string): Classification | null {
  const plain = plainTitle(title);
  if (plain === 'location') return { kind: 'cityAndRegion', confidence: 0.9 };
  if (/^(current )?(company|employer)( name)?$/.test(plain)) {
    return { kind: 'employer', confidence: 0.85 };
  }
  if (/^(current )?(job )?title$/.test(plain)) {
    return { kind: 'jobTitle', confidence: 0.85 };
  }
  return fromKeywords(plain);
}

async function fillResume(file: File, root: Document): Promise<boolean> {
  return attachResumeViaSlot(file, root, (d) => {
    for (const input of Array.from(d.querySelectorAll<HTMLInputElement>('input[type="file"]'))) {
      if (input.disabled) continue;
      const block = questionBlock(input);
      if (block && RESUME_HINTS.test(block.title)) return input;
    }
    return findResumeInput(d);
  });
}

function getJobDescription(doc: Document): string {
  const byCss = pickJobDescriptionByCss(doc, ['[class^="typography-"]', 'main']);
  if (byCss) return byCss;
  if (doc.body) return clipJobDescription(doc.body.textContent ?? '');
  return '';
}

function detectSubmissionConfirmed(doc: Document, _url: URL): boolean {
  const text = (doc.body?.textContent ?? '').slice(0, 5000);
  if (GEM_CONFIRMATION_RE.test(text)) return true;
  const formGone = !doc.querySelector('button[type="submit"]');
  return formGone && hasSubmissionConfirmText(doc);
}
