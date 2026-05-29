/**
 * Adapter priority order. The detector walks this list in order, picks the
 * first adapter whose `matches()` returns true. `generic` must always be
 * last — it's the fallback that handles arbitrary forms.
 *
 * Per-platform adapters are listed by how often they ship in practice (most
 * job postings ATS-wise: Greenhouse > Lever > Ashby > Workday). Order among
 * them only matters for sites that match more than one — currently none do,
 * because each `matches()` keys off a distinctive hostname.
 */

import type { PlatformAdapter } from './types';
import { greenhouseAdapter } from './greenhouse';
import { leverAdapter } from './lever';
import { ashbyAdapter } from './ashby';
import { workdayAdapter } from './workday';
import { genericAdapter } from './generic';

export const adapters: PlatformAdapter[] = [
  greenhouseAdapter,
  leverAdapter,
  ashbyAdapter,
  workdayAdapter,
  genericAdapter,
];
