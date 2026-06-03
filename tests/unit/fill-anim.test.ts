import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  FILL_ANIM,
  applyFlash,
  beginRun,
  clearFlashes,
  delay,
  isCurrentRun,
  prefersReducedMotion,
} from '@/content/fill-anim';
import { fillField } from '@/content/filler';
import type { DetectedField, FieldKind } from '@/adapters/types';

function field(el: HTMLElement, kind: FieldKind): DetectedField {
  return { el, kind, label: kind, confidence: 1 };
}

function mockReducedMotion(reduce: boolean): void {
  // matchMedia isn't in jsdom; install a minimal stub.
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (q: string) => ({
      matches: reduce && q.includes('reduce'),
      media: q,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

describe('fill-anim — design timings', () => {
  it('exposes the canonical durations from Fill Trigger Concepts', () => {
    expect(FILL_ANIM.STAGGER_MS).toBe(130);
    expect(FILL_ANIM.FLASH_HOLD_MS).toBe(720);
    expect(FILL_ANIM.SETTLE_MS).toBe(260);
  });
});

describe('prefersReducedMotion', () => {
  afterEach(() => {
    delete (window as { matchMedia?: unknown }).matchMedia;
  });

  it('returns true when the system asks for reduced motion', () => {
    mockReducedMotion(true);
    expect(prefersReducedMotion()).toBe(true);
  });

  it('returns false otherwise', () => {
    mockReducedMotion(false);
    expect(prefersReducedMotion()).toBe(false);
  });

  it('returns false if matchMedia throws', () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: () => {
        throw new Error('boom');
      },
    });
    expect(prefersReducedMotion()).toBe(false);
  });
});

describe('applyFlash', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '<input id="x" />';
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('applies the design ring + sky tint, then restores inline styles', () => {
    const el = document.getElementById('x') as HTMLInputElement;
    expect(el.style.cssText).toBe('');

    applyFlash(el);
    expect(el.style.boxShadow).toContain('#0ea5e9');
    // jsdom normalises rgba() — match ignoring spaces.
    expect(el.style.backgroundColor.replace(/\s/g, '')).toContain('rgba(14,165,233,0.06)');

    // After the full hold + fade window, the inline style should be empty again.
    vi.advanceTimersByTime(FILL_ANIM.FLASH_HOLD_MS + FILL_ANIM.FLASH_FADE_MS + 10);
    expect(el.style.boxShadow).toBe('');
    expect(el.style.backgroundColor).toBe('');
    expect(el.style.transition).toBe('');
  });

  it('clearFlashes restores styles for any in-flight flash', () => {
    document.body.innerHTML = '<input id="a"/><input id="b"/>';
    const a = document.getElementById('a') as HTMLInputElement;
    const b = document.getElementById('b') as HTMLInputElement;
    applyFlash(a);
    applyFlash(b);
    expect(a.style.boxShadow).not.toBe('');
    expect(b.style.boxShadow).not.toBe('');
    clearFlashes();
    expect(a.style.boxShadow).toBe('');
    expect(b.style.boxShadow).toBe('');
  });

  it('does not throw on a null element', () => {
    expect(() => applyFlash(null)).not.toThrow();
    expect(() => applyFlash(undefined)).not.toThrow();
  });
});

describe('run tokens', () => {
  it('only the latest token is current', () => {
    const first = beginRun();
    expect(isCurrentRun(first)).toBe(true);
    const second = beginRun();
    expect(isCurrentRun(first)).toBe(false);
    expect(isCurrentRun(second)).toBe(true);
  });
});

describe('delay', () => {
  it('resolves after the requested ms', async () => {
    vi.useFakeTimers();
    let done = false;
    const p = delay(50).then(() => {
      done = true;
    });
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(50);
    await p;
    expect(done).toBe(true);
    vi.useRealTimers();
  });
});

describe('filler — suppressFlash plumbing', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '<input name="first" />';
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('does not run the built-in flash when suppressFlash is true', () => {
    const el = document.querySelector('input')!;
    const action = fillField(field(el, 'firstName'), 'Ada', {
      forceOverwrite: false,
      suppressFlash: true,
    });
    expect(action.status).toBe('filled');
    expect(el.value).toBe('Ada');
    // The built-in flash sets boxShadow synchronously; with suppression it stays clean.
    expect(el.style.boxShadow).toBe('');
  });

  it('still runs the built-in flash when suppressFlash is omitted (back-compat)', () => {
    const el = document.querySelector('input')!;
    const action = fillField(field(el, 'firstName'), 'Ada', { forceOverwrite: false });
    expect(action.status).toBe('filled');
    expect(el.style.boxShadow).not.toBe('');
  });
});
