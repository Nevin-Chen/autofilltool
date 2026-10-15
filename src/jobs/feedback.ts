import { z } from 'zod';
import { JobFeedbackSchema, type JobFeedback } from './schema';

export const JOB_FEEDBACK_KEY = 'jobFeedback';
export const MAX_JOB_FEEDBACK = 200;
export const DISAGREEMENTS_IN_PROMPT = 10;

const FeedbackListSchema = z.array(JobFeedbackSchema);

function parseFeedback(raw: unknown): JobFeedback[] {
  const parsed = FeedbackListSchema.safeParse(raw);
  return parsed.success ? parsed.data : [];
}

export async function getJobFeedback(): Promise<JobFeedback[]> {
  const got = await chrome.storage.local.get(JOB_FEEDBACK_KEY);
  return parseFeedback(got[JOB_FEEDBACK_KEY]);
}

async function setJobFeedback(list: JobFeedback[]): Promise<void> {
  await chrome.storage.local.set({ [JOB_FEEDBACK_KEY]: list.slice(-MAX_JOB_FEEDBACK) });
}

export async function saveJobFeedback(entry: JobFeedback): Promise<JobFeedback[]> {
  const next = [...(await getJobFeedback()).filter((f) => f.jobId !== entry.jobId), entry];
  await setJobFeedback(next);
  return next.slice(-MAX_JOB_FEEDBACK);
}

export async function removeJobFeedback(jobId: string): Promise<JobFeedback[]> {
  const next = (await getJobFeedback()).filter((f) => f.jobId !== jobId);
  await setJobFeedback(next);
  return next;
}

export function recentDisagreements(
  list: readonly JobFeedback[],
  limit: number = DISAGREEMENTS_IN_PROMPT,
): JobFeedback[] {
  return list.filter((f) => !f.agree).slice(-limit);
}

export function agreementStats(list: readonly JobFeedback[]): { rated: number; agreed: number } {
  return { rated: list.length, agreed: list.filter((f) => f.agree).length };
}

export function subscribeJobFeedback(listener: (list: JobFeedback[]) => void): () => void {
  const handler = (
    changes: { [key: string]: chrome.storage.StorageChange },
    areaName: chrome.storage.AreaName,
  ) => {
    if (areaName !== 'local' || !(JOB_FEEDBACK_KEY in changes)) return;
    listener(parseFeedback(changes[JOB_FEEDBACK_KEY]?.newValue));
  };
  chrome.storage.onChanged.addListener(handler);
  return () => chrome.storage.onChanged.removeListener(handler);
}
