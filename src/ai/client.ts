/**
 * Provider-agnostic AI client. `dispatch()` picks the provider and yields text
 * chunks via an async iterator; only the background worker calls it. Providers
 * are pure: prompt + key in, chunks out — no storage, no Profile knowledge.
 */

import type { Profile, AiSettings, ResumeRecord } from '@/profile/schema';
import { streamOpenAI, OPENAI_DEFAULT_MODEL } from './providers/openai';
import { streamAnthropic, ANTHROPIC_DEFAULT_MODEL } from './providers/anthropic';
import { streamGemini, GEMINI_DEFAULT_MODEL } from './providers/gemini';
import { streamOllama, OLLAMA_DEFAULT_MODEL } from './providers/ollama';
import { extractResumeText } from './resume-text';

export { extractResumeText }; // re-export so existing test imports keep working

export type SuggestRequest = {
  /** The question text the user is being asked to answer. */
  question: string;
  /** The label that introduces the question on the page (e.g. "Why us?"). */
  label?: string;
  /** Loose page context the adapter or content script extracted. */
  job?: { company?: string; role?: string; jobUrl?: string };
  /** JD text from the adapter's `getJobDescription` (~3000 chars). Optional: may be empty. */
  jobDescription?: string;
  /** Any character ceiling visible on the page (e.g. textarea maxLength). */
  maxChars?: number;
};

export type StreamEvent =
  | { kind: 'delta'; text: string }
  | { kind: 'done' }
  | { kind: 'error'; message: string };

/**
 * Routes to the configured provider. Yields a `delta` per chunk, then a
 * single `done`. On failure yields one `error` and stops.
 */
export async function* dispatch(
  req: SuggestRequest,
  settings: AiSettings,
  profile: Profile,
  resume: ResumeRecord | null,
): AsyncGenerator<StreamEvent, void, unknown> {
  if (settings.provider === 'none') {
    yield {
      kind: 'error',
      message: 'No AI provider configured. Open Options → AI to add a key.',
    };
    return;
  }
  // Ollama runs locally without auth; every other provider needs the key.
  if (settings.provider !== 'ollama' && !settings.apiKey) {
    yield {
      kind: 'error',
      message: 'No AI provider configured. Open Options → AI to add a key.',
    };
    return;
  }

  const prompt = await buildPrompt(req, profile, resume);

  try {
    if (settings.provider === 'openai') {
      const model = settings.model || OPENAI_DEFAULT_MODEL;
      for await (const text of streamOpenAI({
        apiKey: settings.apiKey,
        model,
        system: prompt.system,
        user: prompt.user,
        maxTokens: estimateTokens(req.maxChars),
      })) {
        yield { kind: 'delta', text };
      }
    } else if (settings.provider === 'anthropic') {
      const model = settings.model || ANTHROPIC_DEFAULT_MODEL;
      for await (const text of streamAnthropic({
        apiKey: settings.apiKey,
        model,
        system: prompt.system,
        user: prompt.user,
        maxTokens: estimateTokens(req.maxChars),
      })) {
        yield { kind: 'delta', text };
      }
    } else if (settings.provider === 'gemini') {
      const model = settings.model || GEMINI_DEFAULT_MODEL;
      for await (const text of streamGemini({
        apiKey: settings.apiKey,
        model,
        system: prompt.system,
        user: prompt.user,
        maxTokens: estimateTokens(req.maxChars),
      })) {
        yield { kind: 'delta', text };
      }
    } else if (settings.provider === 'ollama') {
      const model = settings.model || OLLAMA_DEFAULT_MODEL;
      for await (const text of streamOllama({
        apiKey: settings.apiKey,
        model,
        system: prompt.system,
        user: prompt.user,
        maxTokens: estimateTokens(req.maxChars),
        endpoint: settings.endpoint,
      })) {
        yield { kind: 'delta', text };
      }
    } else {
      yield { kind: 'error', message: `Unknown provider: ${settings.provider}` };
      return;
    }
    yield { kind: 'done' };
  } catch (err) {
    yield {
      kind: 'error',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/* ------------------------------------------------------- prompt building */

export type BuiltPrompt = { system: string; user: string };

/** Defensive JD cap; adapters already clip to ~3000 in `clipJobDescription`. */
const JOB_DESCRIPTION_PROMPT_BUDGET = 3000;

/**
 * Build the provider prompt (exposed for tests). Async because résumé text may
 * need PDF/DOCX parsing. System = writing-assistant role + constraints; user =
 * question + label + job context + JD + profile summary + résumé excerpt.
 */
export async function buildPrompt(
  req: SuggestRequest,
  profile: Profile,
  resume: ResumeRecord | null,
): Promise<BuiltPrompt> {
  const lengthHint = req.maxChars
    ? ` Keep the response under ${req.maxChars} characters.`
    : ' Keep the response to 2-4 short paragraphs.';

  const system = [
    'You are helping the user draft an answer to a job application question.',
    'Write in the first person, in the user\'s authentic voice — direct, specific, no hype.',
    'Ground every claim in details from the profile, résumé, or job description below. Do not invent companies, dates, titles, or skills.',
    'When the job description mentions specific responsibilities, qualifications, or values, mirror that vocabulary in your answer — but only when the user\'s actual experience supports it.',
    'If the profile lacks enough detail to answer well, write a short honest placeholder rather than fabricating.',
    `Match the question's tone.${lengthHint}`,
    'Return only the answer text — no preamble, no quotes, no markdown headings.',
  ].join(' ');

  const profileSummary = summarizeProfile(profile);
  const resumeText = resume ? await extractResumeText(resume) : '';
  const jobDescription = req.jobDescription
    ? truncate(req.jobDescription.trim(), JOB_DESCRIPTION_PROMPT_BUDGET)
    : '';
  const job =
    req.job && (req.job.company || req.job.role)
      ? `Applying for ${req.job.role ?? 'a role'}${req.job.company ? ` at ${req.job.company}` : ''}.`
      : '';

  const userParts = [
    job,
    req.label ? `Question label: ${req.label}` : '',
    `Question: ${req.question}`,
    '',
  ];
  if (jobDescription) {
    userParts.push('Job description (from the posting):', jobDescription, '');
  }
  userParts.push('Profile:', profileSummary || '(empty)', '');
  if (resumeText) {
    userParts.push('Résumé (text excerpt):', resumeText, '');
  }
  userParts.push('Now write the answer.');

  return { system, user: userParts.filter(Boolean).join('\n') };
}

/** Short bulleted summary of the parts of Profile that help an LLM write. */
export function summarizeProfile(profile: Profile): string {
  const lines: string[] = [];
  const name =
    [profile.preferredName || profile.firstName, profile.lastName]
      .filter(Boolean)
      .join(' ') || '';
  if (name) lines.push(`- Name: ${name}`);
  if (profile.links.linkedin) lines.push(`- LinkedIn: ${profile.links.linkedin}`);
  if (profile.links.github) lines.push(`- GitHub: ${profile.links.github}`);
  if (profile.links.portfolio) lines.push(`- Portfolio: ${profile.links.portfolio}`);
  if (profile.workAuth.desiredSalary) {
    lines.push(`- Desired comp: ${profile.workAuth.desiredSalary}`);
  }
  if (profile.savedAnswers.length > 0) {
    lines.push('- Previously written answers:');
    for (const a of profile.savedAnswers.slice(0, 5)) {
      lines.push(`  · "${a.questionPattern}" → ${truncate(a.answer, 300)}`);
    }
  }
  if (profile.defaultCoverLetter) {
    lines.push(`- Default cover letter blurb: ${truncate(profile.defaultCoverLetter, 500)}`);
  }
  return lines.join('\n');
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + '…';
}

/** Rough cap on output tokens given a character budget; ~4 chars/token. */
function estimateTokens(maxChars: number | undefined): number {
  if (!maxChars) return 800;
  return Math.max(64, Math.min(2048, Math.round(maxChars / 3)));
}
