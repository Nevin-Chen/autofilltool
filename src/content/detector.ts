/**
 * Adapter selection. Walks the registry in priority order and returns the
 * first adapter whose `matches()` succeeds. The generic adapter is always at
 * the end, so this is guaranteed to return something.
 */

import { adapters } from '@/adapters/registry';
import type { PlatformAdapter } from '@/adapters/types';

export function pickAdapter(url: URL, doc: Document): PlatformAdapter {
  for (const adapter of adapters) {
    try {
      if (adapter.matches(url, doc)) return adapter;
    } catch {
      // A buggy matches() must not break detection for everyone else.
      continue;
    }
  }
  // Registry guarantees `generic` is last; this is just a belt-and-suspenders.
  const fallback = adapters[adapters.length - 1];
  if (!fallback) throw new Error('adapter registry is empty');
  return fallback;
}
