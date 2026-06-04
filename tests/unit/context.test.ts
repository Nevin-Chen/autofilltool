import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isExtensionContextValid } from '@/lib/context';

/**
 * The helper exists so the content script can fail fast on Chrome MV3 dev-mode
 * context invalidation (Vite rebuild → stale chrome.runtime). It must treat
 * "no chrome", "chrome present but no runtime.id", and "throw on access" all
 * as invalidated.
 */
describe('isExtensionContextValid', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = globalThis as any;
  let original: unknown;

  beforeEach(() => {
    original = g.chrome;
  });
  afterEach(() => {
    if (typeof original === 'undefined') delete g.chrome;
    else g.chrome = original;
  });

  it('returns true when chrome.runtime.id is set', () => {
    g.chrome = { runtime: { id: 'abc' } };
    expect(isExtensionContextValid()).toBe(true);
  });

  it('returns false when chrome.runtime.id is undefined (invalidated)', () => {
    g.chrome = { runtime: {} };
    expect(isExtensionContextValid()).toBe(false);
  });

  it('returns false when chrome is missing entirely', () => {
    delete g.chrome;
    expect(isExtensionContextValid()).toBe(false);
  });

  it('returns false when accessing runtime throws', () => {
    g.chrome = {
      get runtime() {
        throw new Error('Extension context invalidated.');
      },
    };
    expect(isExtensionContextValid()).toBe(false);
  });
});
