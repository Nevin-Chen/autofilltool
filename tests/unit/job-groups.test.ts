import { describe, expect, it } from 'vitest';
import { groupByCheck } from '@/jobs/groups';
import { formatCheckDateTime } from '@/jobs/summary';
import type { JobCheck } from '@/jobs/schema';
import { NOW, judged } from './job-fixtures';

function check(id: string, startedAt: string, status: JobCheck['status'] = 'ok'): JobCheck {
  return { id, startedAt, finishedAt: startedAt, status, phase: '', error: null, counts: null, progress: null };
}

describe('groupByCheck', () => {
  const morning = check('morning', '2026-10-13T13:00:00.000Z');
  const afternoon = check('afternoon', '2026-10-13T17:00:00.000Z', 'stopped');

  it('puts each check in its own group, newest first, with its jobs and status', () => {
    const groups = groupByCheck(
      [
        judged({ id: 'example:a', checkId: 'morning', verdict: 'strong' }),
        judged({ id: 'example:b', checkId: 'afternoon', verdict: 'maybe' }),
        judged({ id: 'example:c', checkId: 'morning', verdict: 'skip' }),
      ],
      [morning, afternoon],
    );
    expect(groups.map((g) => [g.checkId, g.status, g.jobs.map((j) => j.id)])).toEqual([
      ['afternoon', 'stopped', ['example:b']],
      ['morning', 'ok', ['example:a', 'example:c']],
    ]);
    expect(groups[1]?.tally).toEqual({ strong: 1, maybe: 0, skip: 1, repeat: 0 });
  });

  it('uses the check start time even when jobs were judged later', () => {
    const [group] = groupByCheck([judged({ checkId: 'morning', judgedAt: '2026-10-13T13:20:00.000Z' })], [morning]);
    expect(group?.startedAt).toBe('2026-10-13T13:00:00.000Z');
  });

  it('dates a group whose check record is gone by its earliest judged job', () => {
    const [group] = groupByCheck(
      [
        judged({ id: 'example:a', checkId: 'pruned', judgedAt: '2026-10-10T15:30:00.000Z' }),
        judged({ id: 'example:b', checkId: 'pruned', judgedAt: '2026-10-10T15:10:00.000Z' }),
      ],
      [],
    );
    expect(group).toMatchObject({ startedAt: '2026-10-10T15:10:00.000Z', status: null });
  });
});

describe('formatCheckDateTime', () => {
  it('says today, yesterday, or the date', () => {
    expect(formatCheckDateTime(NOW.toISOString(), NOW)).toMatch(/^Today, /);
    expect(formatCheckDateTime(new Date(NOW.getTime() - 24 * 3_600_000).toISOString(), NOW)).toMatch(/^Yesterday, /);
    expect(formatCheckDateTime(new Date(NOW.getTime() - 3 * 24 * 3_600_000).toISOString(), NOW)).not.toMatch(/^(Today|Yesterday)/);
  });
});
