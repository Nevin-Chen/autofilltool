import { localDateKey } from './dedupe';
import type { JobCheck } from './schema';
import { isStale } from './store';

export const JOBS_PAGE_PATH = 'src/ui/jobs/index.html';

export function formatCheckTime(iso: string, now: Date): string {
  const at = new Date(iso);
  const time = at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (localDateKey(at) === localDateKey(now)) return time;
  return `${at.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`;
}

export function formatCheckDateTime(iso: string, now: Date): string {
  const at = new Date(iso);
  const time = at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (localDateKey(at) === localDateKey(now)) return `Today, ${time}`;
  if (localDateKey(at) === localDateKey(yesterday)) return `Yesterday, ${time}`;
  return `${at.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}, ${time}`;
}

export function describeCheck(check: JobCheck | null, now: Date): string {
  if (!check) return 'No checks yet';
  if (check.status === 'running') {
    return isStale(check, now) ? 'Last check was interrupted' : check.phase || 'Checking';
  }
  const at = formatCheckTime(check.finishedAt ?? check.startedAt, now);
  if (check.status === 'failed') return `Check failed at ${at}`;
  const verb = check.status === 'stopped' ? 'Stopped' : 'Checked';
  const counts = check.counts;
  if (!counts) return `${verb} at ${at}`;
  return `${verb} at ${at}: ${counts.strong} strong, ${counts.maybe} maybe, ${counts.judged} new`;
}
