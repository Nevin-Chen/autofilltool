import { z } from 'zod';

export const JobListingSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  title: z.string(),
  company: z.string(),
  location: z.string(),
  workplace: z.string().nullable(),
  category: z.string().nullable(),
  minYoe: z.number().nullable(),
  pay: z.string().nullable(),
  postedAt: z.string(),
  requirements: z.string(),
  tools: z.array(z.string()),
  listingUrl: z.string(),
  applyUrl: z.string().nullable(),
  easyApply: z.boolean().default(false),
});
export type JobListing = z.infer<typeof JobListingSchema>;

export const JobVerdictSchema = z.enum(['strong', 'maybe', 'skip', 'repeat']);
export type JobVerdict = z.infer<typeof JobVerdictSchema>;

export const RequirementStatusSchema = z.enum(['met', 'partial', 'missing']);
export type RequirementStatus = z.infer<typeof RequirementStatusSchema>;

export const RequirementCheckSchema = z.object({
  text: z.string(),
  importance: z.enum(['must', 'nice']),
  status: RequirementStatusSchema,
  evidence: z.string(),
  verified: z.boolean(),
});
export type RequirementCheck = z.infer<typeof RequirementCheckSchema>;

export const DeepReviewSchema = z.object({
  requirements: z.array(RequirementCheckSchema),
  yearsAsked: z.number().nullable(),
  flags: z.array(z.string()),
  confidence: z.enum(['high', 'medium', 'low']),
  summary: z.string(),
  descriptionSource: z.enum(['full', 'summary']),
  claudeVerdict: z.enum(['strong', 'maybe', 'skip']),
  demotedForUnverifiedEvidence: z.boolean(),
});
export type DeepReview = z.infer<typeof DeepReviewSchema>;

export const JudgedJobSchema = JobListingSchema.extend({
  fingerprint: z.string(),
  verdict: JobVerdictSchema,
  reason: z.string(),
  repeatOf: z.string().nullable(),
  checkId: z.string(),
  judgedAt: z.string(),
  review: DeepReviewSchema.nullable().default(null),
});
export type JudgedJob = z.infer<typeof JudgedJobSchema>;

export const JobCheckCountsSchema = z.object({
  postedToday: z.number(),
  alreadySeen: z.number(),
  identicalRepeats: z.number(),
  judged: z.number(),
  unjudged: z.number(),
  strong: z.number(),
  maybe: z.number(),
  skip: z.number(),
  repeat: z.number(),
  reviewed: z.number().default(0),
  summaryOnly: z.number().default(0),
  deferred: z.number().default(0),
  unreadCards: z.number().default(0),
});
export type JobCheckCounts = z.infer<typeof JobCheckCountsSchema>;

export const JobProgressSchema = z.object({
  pagesDone: z.number(),
  pagesPlanned: z.number(),
  pageJobsDone: z.number(),
  pageJobsTotal: z.number(),
  reviewsDone: z.number(),
  reviewsQueued: z.number(),
});
export type JobProgress = z.infer<typeof JobProgressSchema>;

export const JobCheckSchema = z.object({
  id: z.string(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  status: z.enum(['running', 'ok', 'failed']),
  phase: z.string().default(''),
  error: z.string().nullable(),
  counts: JobCheckCountsSchema.nullable(),
  progress: JobProgressSchema.nullable().default(null),
});
export type JobCheck = z.infer<typeof JobCheckSchema>;

export const JobFeedSchema = z.object({
  jobs: z.array(JudgedJobSchema).default([]),
  checks: z.array(JobCheckSchema).default([]),
});
export type JobFeed = z.infer<typeof JobFeedSchema>;

export function emptyJobProgress(): JobProgress {
  return { pagesDone: 0, pagesPlanned: 0, pageJobsDone: 0, pageJobsTotal: 0, reviewsDone: 0, reviewsQueued: 0 };
}

export function progressFractions(progress: JobProgress): { browsing: number; reviews: number | null } {
  const inPage = progress.pageJobsTotal > 0 ? progress.pageJobsDone / progress.pageJobsTotal : 0;
  const browsing = progress.pagesPlanned > 0 ? Math.min(1, (progress.pagesDone + inPage) / progress.pagesPlanned) : 0;
  const reviews = progress.reviewsQueued > 0 ? progress.reviewsDone / progress.reviewsQueued : null;
  return { browsing, reviews };
}

export function emptyJobCounts(): JobCheckCounts {
  return {
    postedToday: 0,
    alreadySeen: 0,
    identicalRepeats: 0,
    judged: 0,
    unjudged: 0,
    strong: 0,
    maybe: 0,
    skip: 0,
    repeat: 0,
    reviewed: 0,
    summaryOnly: 0,
    deferred: 0,
    unreadCards: 0,
  };
}

export const JobFeedbackSchema = z.object({
  jobId: z.string(),
  agree: z.boolean(),
  note: z.string(),
  at: z.string(),
  title: z.string(),
  company: z.string(),
  verdict: JobVerdictSchema,
});
export type JobFeedback = z.infer<typeof JobFeedbackSchema>;
