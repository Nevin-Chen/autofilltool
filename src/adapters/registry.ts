import type { PlatformAdapter } from './types';
import { greenhouseAdapter } from './greenhouse';
import { leverAdapter } from './lever';
import { ashbyAdapter } from './ashby';
import { workdayAdapter } from './workday';
import { jazzhrAdapter } from './jazzhr';
import { workableAdapter } from './workable';
import { breezyAdapter } from './breezy';
import { genericAdapter } from './generic';

export const adapters: PlatformAdapter[] = [
  greenhouseAdapter,
  leverAdapter,
  ashbyAdapter,
  workdayAdapter,
  jazzhrAdapter,
  workableAdapter,
  breezyAdapter,
  genericAdapter,
];
