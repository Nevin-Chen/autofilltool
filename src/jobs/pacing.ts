import type { BrowsingLimits, Range } from '@/jobs/sources';

export type Pacer = <T>(kind: 'load' | 'click', task: () => Promise<T>) => Promise<T>;

export function pickInRange(range: Range, random: () => number): number {
  return range.min + Math.floor(random() * (range.max - range.min + 1));
}

export function createPacer(
  limits: Pick<BrowsingLimits, 'loadGapMs' | 'clickGapMs'>,
  sleep: (ms: number) => Promise<void>,
  random: () => number,
): Pacer {
  let queue: Promise<unknown> = Promise.resolve();
  let started = false;
  return <T>(kind: 'load' | 'click', task: () => Promise<T>): Promise<T> => {
    const run = queue.then(async () => {
      if (started) {
        const { min, max } = kind === 'click' ? limits.clickGapMs : limits.loadGapMs;
        const gap = Math.round(min + random() * (max - min));
        if (gap > 0) await sleep(gap);
      }
      started = true;
      return task();
    });
    queue = run.catch(() => undefined);
    return run;
  };
}

export function createLimiter(limit: number) {
  let active = 0;
  const waiting: Array<() => void> = [];
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (active >= limit) await new Promise<void>((resolve) => waiting.push(resolve));
    active++;
    try {
      return await task();
    } finally {
      active--;
      waiting.shift()?.();
    }
  };
}
