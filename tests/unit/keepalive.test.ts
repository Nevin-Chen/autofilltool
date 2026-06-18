import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { startKeepAlive, KEEPALIVE_INTERVAL_MS } from '@/background/keepalive';

describe('startKeepAlive', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('pings on the interval until stopped', () => {
    const ping = vi.fn();
    const stop = startKeepAlive(ping, 1000);

    expect(ping).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(ping).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2000);
    expect(ping).toHaveBeenCalledTimes(3);

    stop();
    vi.advanceTimersByTime(5000);
    expect(ping).toHaveBeenCalledTimes(3);
  });

  it('ticks under the ~30s MV3 idle limit by default', () => {
    expect(KEEPALIVE_INTERVAL_MS).toBeLessThan(30_000);
  });
});
