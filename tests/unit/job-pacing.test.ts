import { describe, expect, it } from 'vitest';
import { createLimiter, pickInRange } from '@/jobs/pacing';

describe('pickInRange', () => {
  it('picks a whole number anywhere in the range, ends included', () => {
    expect(pickInRange({ min: 7, max: 12 }, () => 0)).toBe(7);
    expect(pickInRange({ min: 7, max: 12 }, () => 0.9999)).toBe(12);
    expect(pickInRange({ min: 45, max: 75 }, () => 0.5)).toBe(60);
  });
});

describe('createLimiter', () => {
  it('never runs more than the limit at once', async () => {
    const limit = createLimiter(3);
    let inFlight = 0;
    let peak = 0;
    await Promise.all(
      [1, 2, 3, 4, 5, 6, 7].map(() =>
        limit(async () => {
          inFlight++;
          peak = Math.max(peak, inFlight);
          await new Promise((resolve) => setTimeout(resolve, 2));
          inFlight--;
        }),
      ),
    );
    expect(peak).toBe(3);
  });
});
