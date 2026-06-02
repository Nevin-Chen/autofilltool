import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fillField } from '@/content/filler';
import type { DetectedField, FieldKind } from '@/adapters/types';

function loadFixture(): string {
  return readFileSync(resolve(__dirname, '../e2e/fixtures/mixed-fields.html'), 'utf8');
}

function field(el: HTMLElement, kind: FieldKind): DetectedField {
  return { el, kind, label: kind, confidence: 1 };
}

describe('post-fill highlight (FR-010)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.documentElement.innerHTML = loadFixture();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('highlights a field we filled, then restores its inline style exactly', () => {
    const empty = document.querySelector<HTMLInputElement>('input[name="first_name"]')!;
    expect(empty.style.cssText).toBe(''); // as found: no inline style

    const action = fillField(field(empty, 'firstName'), 'Ada', { forceOverwrite: false });
    expect(action.status).toBe('filled');
    expect(empty.style.boxShadow).not.toBe(''); // highlight applied

    vi.advanceTimersByTime(2000); // past hold + fade
    expect(empty.style.boxShadow).toBe(''); // highlight removed
    expect(empty.style.transition).toBe(''); // transition restored
    expect(empty.style.cssText).toBe(''); // left exactly as found
  });

  it('does NOT highlight a pre-filled field we skipped', () => {
    const prefilled = document.querySelector<HTMLInputElement>('input[name="last_name"]')!;
    const action = fillField(field(prefilled, 'lastName'), 'Lovelace', {
      forceOverwrite: false,
    });
    expect(action.status).toBe('skipped');
    expect(prefilled.style.boxShadow).toBe('');
    vi.advanceTimersByTime(2000);
    expect(prefilled.style.boxShadow).toBe('');
  });
});
