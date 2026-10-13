import { z } from 'zod';
import { candidateBlock, type CandidateContext } from './candidate';
import type { DeepReview, JobListing, RequirementCheck } from './schema';

export const JOB_REVIEW_MODEL = 'opus';
export const JOB_REVIEW_MAX_TOKENS = 6000;
export const JOB_REVIEW_CONCURRENCY = 3;
export const DESCRIPTION_CHAR_BUDGET = 12_000;
export const MIN_FULL_DESCRIPTION_CHARS = 400;

const REVIEW_SYSTEM_PROMPT = [
  'You review one job posting for one candidate, requirement by requirement, and decide whether they should apply.',
  '',
  '1. List every requirement in the posting: skills, years of experience, education, domain knowledge, and the nice-to-haves. Mark each "must" or "nice" the way the posting frames it.',
  '2. For each requirement, look for evidence in the résumé or profile. Copy the supporting phrase into "evidence" word for word, 3 to 20 words, with no paraphrasing, so it can be found in the résumé text. If nothing supports it, leave evidence empty and mark it "missing". Use "partial" when the evidence is adjacent rather than the same thing, such as Vue for a React requirement or 2 years against 3.',
  '3. Put anything that changes whether they should apply in "flags": onsite or hybrid away from where they live, travel, a security clearance, sponsorship, unusual hours, a contract or temporary role, or pay below what they want.',
  '4. Decide the verdict:',
  '   - strong: every must-have is met or nearly met. Apply now.',
  '   - maybe: worth applying, with a gap you can name.',
  '   - skip: a must-have is clearly missing, or the posting hits a dealbreaker in the candidate\'s criteria.',
  '5. confidence: high when the posting is detailed and the evidence is clear, low when the description is thin or vague.',
  '6. summary: 2 or 3 sentences written to the candidate: the main overlap, the main gap, and what to stress when applying.',
  '',
  "The candidate's criteria override these defaults. When the candidate has disagreed with a past verdict, follow their judgment for similar postings.",
  '',
  'Reply with only a JSON object and nothing else:',
  '{"requirements": [{"text": "<requirement>", "importance": "must" | "nice", "status": "met" | "partial" | "missing", "evidence": "<exact résumé phrase or empty>"}], "yearsAsked": <number or null>, "flags": ["<flag>"], "verdict": "strong" | "maybe" | "skip", "confidence": "high" | "medium" | "low", "summary": "<summary>"}',
].join('\n');

export type ReviewInput = {
  listing: JobListing;
  description: string;
  descriptionSource: DeepReview['descriptionSource'];
};

export function buildReviewPrompt(
  input: ReviewInput,
  context: CandidateContext,
): { system: string; user: string } {
  const { listing } = input;
  const place = listing.workplace ? `${listing.location} (${listing.workplace})` : listing.location;
  const sourceNote =
    input.descriptionSource === 'full'
      ? 'Description (the full posting):'
      : "Description (only the job board's short summary; the full posting could not be read, so lower your confidence):";
  const user = [
    candidateBlock(context),
    '',
    'Job posting:',
    `Title: ${listing.title}`,
    `Company: ${listing.company || 'not listed'}`,
    `Location: ${place || 'not listed'}`,
    `Pay: ${listing.pay ?? 'not listed'}`,
    `Years asked, per the job board: ${listing.minYoe ?? 'not listed'}`,
    `Tools, per the job board: ${listing.tools.join(', ') || 'not listed'}`,
    '',
    sourceNote,
    input.description.slice(0, DESCRIPTION_CHAR_BUDGET),
  ].join('\n');
  return { system: REVIEW_SYSTEM_PROMPT, user };
}

const RawReviewSchema = z.object({
  requirements: z
    .array(
      z.object({
        text: z.string(),
        importance: z.enum(['must', 'nice']).catch('must'),
        status: z.enum(['met', 'partial', 'missing']),
        evidence: z.string().default(''),
      }),
    )
    .default([]),
  yearsAsked: z.number().nullable().catch(null),
  flags: z.array(z.string()).default([]),
  verdict: z.enum(['strong', 'maybe', 'skip']),
  confidence: z.enum(['high', 'medium', 'low']).catch('medium'),
  summary: z.string().default(''),
});
export type RawReview = z.infer<typeof RawReviewSchema>;

export function parseReviewResponse(text: string): RawReview | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  const result = RawReviewSchema.safeParse(parsed);
  return result.success ? result.data : null;
}

export function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/[•●▪·]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["'\s]+|["'.,;:\s]+$/g, '');
}

export function evidenceIsVerified(evidence: string, haystack: string): boolean {
  const needle = normalizeForMatch(evidence);
  return needle.length > 0 && normalizeForMatch(haystack).includes(needle);
}

export function finalizeReview(
  raw: RawReview,
  haystack: string,
  descriptionSource: DeepReview['descriptionSource'],
): { verdict: DeepReview['claudeVerdict']; review: DeepReview } {
  const requirements: RequirementCheck[] = raw.requirements.map((requirement) => ({
    text: requirement.text.trim(),
    importance: requirement.importance,
    status: requirement.status,
    evidence: requirement.evidence.trim(),
    verified: requirement.status !== 'missing' && evidenceIsVerified(requirement.evidence, haystack),
  }));
  const leansOnUnverified = requirements.some(
    (r) => r.importance === 'must' && r.status !== 'missing' && !r.verified,
  );
  const demoted = raw.verdict === 'strong' && leansOnUnverified;
  return {
    verdict: demoted ? 'maybe' : raw.verdict,
    review: {
      requirements,
      yearsAsked: raw.yearsAsked,
      flags: raw.flags.map((flag) => flag.trim()).filter(Boolean),
      confidence: raw.confidence,
      summary: raw.summary.trim(),
      descriptionSource,
      claudeVerdict: raw.verdict,
      demotedForUnverifiedEvidence: demoted,
    },
  };
}
