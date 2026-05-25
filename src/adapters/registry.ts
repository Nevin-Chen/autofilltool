/**
 * Adapter priority order. The detector walks this list in order, picks the
 * first adapter whose `matches()` returns true. `generic` must always be
 * last — it's the fallback that handles arbitrary forms.
 *
 * Greenhouse / Lever / Ashby / Workday adapters arrive in later roadmap
 * steps; importing them here would force them to ship empty, so we add them
 * to the registry as they land.
 */

import type { PlatformAdapter } from './types';
import { genericAdapter } from './generic';

export const adapters: PlatformAdapter[] = [
  // greenhouseAdapter, // step 4
  // leverAdapter,      // step 4
  // ashbyAdapter,      // step 4
  // workdayAdapter,    // step 7
  genericAdapter,
];
