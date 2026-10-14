import type { JobCheck, JobVerdict, JudgedJob } from './schema';

export type CheckGroup = {
  checkId: string;
  startedAt: string;
  status: JobCheck['status'] | null;
  jobs: JudgedJob[];
  tally: Record<JobVerdict, number>;
};

export function groupByCheck(jobs: readonly JudgedJob[], checks: readonly JobCheck[]): CheckGroup[] {
  const checksById = new Map(checks.map((check) => [check.id, check]));
  const groups = new Map<string, CheckGroup>();
  for (const job of jobs) {
    let group = groups.get(job.checkId);
    if (!group) {
      const check = checksById.get(job.checkId);
      group = {
        checkId: job.checkId,
        startedAt: check?.startedAt ?? job.judgedAt,
        status: check?.status ?? null,
        jobs: [],
        tally: { strong: 0, maybe: 0, skip: 0, repeat: 0 },
      };
      groups.set(job.checkId, group);
    }
    if (!checksById.has(job.checkId) && Date.parse(job.judgedAt) < Date.parse(group.startedAt)) {
      group.startedAt = job.judgedAt;
    }
    group.jobs.push(job);
    group.tally[job.verdict]++;
  }
  return [...groups.values()].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
}
