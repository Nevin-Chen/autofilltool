import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_JOB_FEEDBACK,
  agreementStats,
  getJobFeedback,
  recentDisagreements,
  removeJobFeedback,
  saveJobFeedback,
} from '@/jobs/feedback';
import type { JobFeedback } from '@/jobs/schema';

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
      },
    },
  });
});

function feedback(overrides: Partial<JobFeedback> = {}): JobFeedback {
  return {
    jobId: 'example:k2stripe0001',
    agree: true,
    note: '',
    at: '2026-10-13T18:00:00.000Z',
    title: 'Software Engineer, Payments',
    company: 'Stripe',
    verdict: 'strong',
    ...overrides,
  };
}

describe('job feedback storage', () => {
  it('replaces earlier feedback on the same job', async () => {
    await saveJobFeedback(feedback());
    await saveJobFeedback(feedback({ agree: false, note: 'Payments infra is too backend-heavy for me.' }));
    const saved = await getJobFeedback();
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ agree: false, note: 'Payments infra is too backend-heavy for me.' });
  });

  it(`keeps the newest ${MAX_JOB_FEEDBACK} entries`, async () => {
    for (let i = 0; i < MAX_JOB_FEEDBACK + 3; i++) {
      store.jobFeedback = [...((store.jobFeedback as JobFeedback[]) ?? []), feedback({ jobId: `job-${i}` })];
    }
    await saveJobFeedback(feedback({ jobId: 'latest' }));
    const saved = await getJobFeedback();
    expect(saved).toHaveLength(MAX_JOB_FEEDBACK);
    expect(saved.at(-1)?.jobId).toBe('latest');
  });

  it('removes feedback for a job', async () => {
    await saveJobFeedback(feedback());
    await removeJobFeedback('example:k2stripe0001');
    expect(await getJobFeedback()).toEqual([]);
  });
});

describe('recentDisagreements', () => {
  it('returns only disagreements, newest last, up to the limit', () => {
    const list = [
      feedback({ jobId: 'a', agree: false }),
      feedback({ jobId: 'b', agree: true }),
      feedback({ jobId: 'c', agree: false }),
      feedback({ jobId: 'd', agree: false }),
    ];
    expect(recentDisagreements(list, 2).map((f) => f.jobId)).toEqual(['c', 'd']);
  });
});

describe('agreementStats', () => {
  it('counts rated and agreed verdicts', () => {
    expect(agreementStats([feedback(), feedback({ jobId: 'x', agree: false })])).toEqual({ rated: 2, agreed: 1 });
  });
});
