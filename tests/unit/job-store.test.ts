import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  JOB_FEED_KEY,
  MAX_JOB_CHECKS,
  getJobFeed,
  markRunningCheckStopped,
  runningCheck,
  setJobFeed,
} from '@/jobs/store';
import { describeCheck } from '@/jobs/summary';
import { emptyJobCounts } from '@/jobs/schema';
import type { JobCheck } from '@/jobs/schema';
import { NOW, judged } from './job-fixtures';

const store: Record<string, unknown> = {};

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: store[key] })),
        set: vi.fn(async (obj: Record<string, unknown>) => {
          Object.assign(store, obj);
        }),
        remove: vi.fn(async (key: string) => {
          delete store[key];
        }),
      },
    },
  });
});

function check(overrides: Partial<JobCheck> = {}): JobCheck {
  return {
    id: 'check-1',
    startedAt: NOW.toISOString(),
    finishedAt: null,
    status: 'running',
    phase: 'Reading Software engineer',
    error: null,
    counts: null,
    progress: null,
    ...overrides,
  };
}

describe('job feed storage', () => {
  it('starts empty when nothing is stored or the stored value is malformed', async () => {
    expect(await getJobFeed()).toEqual({ jobs: [], checks: [] });
    store[JOB_FEED_KEY] = { schemaVersion: 1, data: { jobs: 'nope' } };
    expect(await getJobFeed()).toEqual({ jobs: [], checks: [] });
  });

  it('drops jobs judged more than 7 days ago on save', async () => {
    await setJobFeed(
      {
        jobs: [
          judged({ id: 'example:recent', judgedAt: '2026-10-10T12:00:00.000Z' }),
          judged({ id: 'example:old', judgedAt: '2026-10-01T12:00:00.000Z' }),
        ],
        checks: [],
      },
      NOW,
    );
    expect((await getJobFeed()).jobs.map((job) => job.id)).toEqual(['example:recent']);
  });

  it(`keeps the last ${MAX_JOB_CHECKS} checks`, async () => {
    const checks = Array.from({ length: MAX_JOB_CHECKS + 5 }, (_, i) =>
      check({ id: `check-${i}`, status: 'ok' }),
    );
    await setJobFeed({ jobs: [], checks }, NOW);
    const saved = (await getJobFeed()).checks;
    expect(saved).toHaveLength(MAX_JOB_CHECKS);
    expect(saved[0]?.id).toBe('check-5');
  });
});

describe('runningCheck', () => {
  it('returns the latest check while it is running', () => {
    expect(runningCheck({ jobs: [], checks: [check()] }, NOW)?.id).toBe('check-1');
  });

  it('treats a check running for over 10 minutes as interrupted', () => {
    const later = new Date(NOW.getTime() + 11 * 60 * 1000);
    expect(runningCheck({ jobs: [], checks: [check()] }, later)).toBeNull();
  });

  it('returns null once the latest check finished', () => {
    expect(runningCheck({ jobs: [], checks: [check(), check({ id: 'check-2', status: 'ok' })] }, NOW)).toBeNull();
  });
});

describe('markRunningCheckStopped', () => {
  it('turns a check left running into a stopped one', () => {
    const feed = markRunningCheckStopped({ jobs: [], checks: [check({ id: 'old', status: 'ok' }), check()] }, NOW);
    expect(feed.checks.map((c) => c.status)).toEqual(['ok', 'stopped']);
    expect(feed.checks[1]?.finishedAt).toBe(NOW.toISOString());
  });
});

describe('describeCheck', () => {
  it('says a check was stopped and what it found first', () => {
    const counts = { ...emptyJobCounts(), strong: 1, maybe: 2, judged: 5 };
    const text = describeCheck(check({ status: 'stopped', finishedAt: NOW.toISOString(), counts }), NOW);
    expect(text).toMatch(/^Stopped at .+: 1 strong, 2 maybe, 5 new$/);
  });
});
