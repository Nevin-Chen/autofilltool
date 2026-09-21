import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import type { DetectedField } from '@/adapters/types';
import type { JobContext } from '@/content/job-context';

const ctx: JobContext = {
  company: 'Stripe',
  role: 'Engineer',
  jobUrl: 'https://example.com/job',
  jobDescription: '',
};
const HOST = '[data-autofilltool-suggest-host]';
const PILL_INSET = 28;

const observers: FakeResizeObserver[] = [];

class FakeResizeObserver {
  targets: Element[] = [];
  constructor(private cb: ResizeObserverCallback) {
    observers.push(this);
  }
  observe(target: Element) {
    this.targets.push(target);
  }
  unobserve() {}
  disconnect() {}
  fire() {
    this.cb([], this as unknown as ResizeObserver);
  }
}

function resize(target: Element): void {
  for (const o of observers) if (o.targets.includes(target)) o.fire();
}

function rect(top: number, bottom: number): DOMRect {
  return {
    top,
    bottom,
    left: 0,
    right: 400,
    width: 400,
    height: bottom - top,
    x: 0,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

function textareaAt(name: string, box: { top: number; bottom: number }): DetectedField {
  const ta = document.createElement('textarea');
  ta.name = name;
  ta.getBoundingClientRect = () => rect(box.top, box.bottom);
  document.body.appendChild(ta);
  return { el: ta, kind: 'openEnded', label: name, confidence: 0.5 };
}

function hostTops(): number[] {
  return Array.from(document.querySelectorAll<HTMLElement>(HOST)).map((h) =>
    parseFloat(h.style.top),
  );
}

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  observers.length = 0;
  document.documentElement.innerHTML = '<head></head><body></body>';
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('suggest pill positioning across multiple textareas', () => {
  it('moves every pill when one textarea is resized', async () => {
    const { installSuggestButtons } = await import('@/content/suggest');
    const whyUs = { top: 0, bottom: 100 };
    const coverLetter = { top: 120, bottom: 220 };
    const first = textareaAt('why_us', whyUs);
    const second = textareaAt('cover_letter', coverLetter);

    installSuggestButtons([first, second], ctx, { aiConfigured: true });
    expect(hostTops()).toEqual([100 - PILL_INSET, 220 - PILL_INSET]);

    whyUs.bottom = 300;
    coverLetter.top = 320;
    coverLetter.bottom = 420;
    resize(first.el);

    expect(hostTops()).toEqual([300 - PILL_INSET, 420 - PILL_INSET]);
  });

  it('shares one observer across textareas and also watches the document', async () => {
    const { installSuggestButtons } = await import('@/content/suggest');
    const first = textareaAt('why_us', { top: 0, bottom: 100 });
    const second = textareaAt('cover_letter', { top: 120, bottom: 220 });

    installSuggestButtons([first, second], ctx, { aiConfigured: true });

    expect(observers).toHaveLength(1);
    expect(observers[0]?.targets).toEqual([document.documentElement, first.el, second.el]);
  });
});
