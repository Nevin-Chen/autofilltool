import { z } from 'zod';
import { candidateBlock, type CandidateContext } from './candidate';
import type { JudgeCandidate } from './dedupe';
import type { JobListing } from './schema';

export const JOB_SCREEN_MODEL = 'sonnet';
export const JOB_SCREEN_BATCH_SIZE = 20;
export const JOB_SCREEN_MAX_TOKENS = 4000;

export const ScreenVerdictSchema = z.enum(['review', 'skip', 'repeat']);
export type ScreenVerdict = z.infer<typeof ScreenVerdictSchema>;

export type ScreenResult = { verdict: ScreenVerdict; reason: string };

const SCREEN_SYSTEM_PROMPT = [
  'You triage job listings for one candidate before a closer review. For each listing, decide whether it deserves a full read of the job description.',
  '',
  '- review: a software role the candidate could plausibly fit. When unsure, choose review.',
  '- skip: clearly not worth a closer look. That means not a software engineering role, a main language or domain the candidate has no experience in, a hard requirement they cannot meet (an active security clearance, 6+ years with senior scope), or anything the candidate\'s criteria call a dealbreaker.',
  '- repeat: only for a listing that has a sameTitleAs object, when the two describe the same role: same duties and requirements, even reworded or in another city. If they differ, judge the listing on its own.',
  '',
  'When the candidate has disagreed with a past verdict, follow their judgment for similar listings.',
  '',
  'Give each listing one reason under 20 words naming what decided it.',
  '',
  'Reply with only a JSON array and nothing else: [{"id": "<listing id>", "verdict": "review" | "skip" | "repeat", "reason": "<reason>"}], one object per listing, with each id exactly as given.',
].join('\n');

export function buildScreenPrompt(
  candidates: readonly JudgeCandidate[],
  context: CandidateContext,
): { system: string; user: string } {
  const user = [
    candidateBlock(context),
    '',
    'Listings, one JSON object per line:',
    ...candidates.map((candidate) => JSON.stringify(listingForPrompt(candidate))),
  ].join('\n');
  return { system: SCREEN_SYSTEM_PROMPT, user };
}

function listingForPrompt({ listing, sameTitleAs }: JudgeCandidate) {
  return {
    id: listing.id,
    title: listing.title,
    company: listing.company,
    category: listing.category,
    location: listing.location,
    workplace: listing.workplace,
    minYoe: listing.minYoe,
    pay: listing.pay,
    requirements: listing.requirements,
    tools: listing.tools,
    ...(sameTitleAs ? { sameTitleAs: comparisonFields(sameTitleAs) } : {}),
  };
}

function comparisonFields(listing: JobListing) {
  return {
    location: listing.location,
    pay: listing.pay,
    requirements: listing.requirements,
    tools: listing.tools,
  };
}

const ScreenItemSchema = z.object({
  id: z.string(),
  verdict: ScreenVerdictSchema,
  reason: z.string().default(''),
});

export function parseScreenResponse(text: string): Map<string, ScreenResult> {
  const results = new Map<string, ScreenResult>();
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end <= start) return results;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return results;
  }
  if (!Array.isArray(parsed)) return results;
  for (const item of parsed) {
    const result = ScreenItemSchema.safeParse(item);
    if (result.success) {
      results.set(result.data.id, { verdict: result.data.verdict, reason: result.data.reason.trim() });
    }
  }
  return results;
}
