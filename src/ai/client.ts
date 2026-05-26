/**
 * Provider-agnostic AI client. Adds a `dispatch()` that picks the right
 * provider implementation and yields text chunks via an async iterator. The
 * background worker calls this; nothing in the content script does.
 *
 * Providers are pure: they receive a fully-built prompt + the user's key,
 * call their HTTPS API, and yield chunks. They do NOT touch storage or know
 * about Profile.
 */

import type { Profile, AiSettings, ResumeRecord } from '@/profile/schema';
import { streamOpenAI, OPENAI_DEFAULT_MODEL } from './providers/openai';
import { streamAnthropic, ANTHROPIC_DEFAULT_MODEL } from './providers/anthropic';
import { streamGemini, GEMINI_DEFAULT_MODEL } from './providers/gemini';

export type SuggestRequest = {
  /** The question text the user is being asked to answer. */
  question: string;
  /** The label that introduces the question on the page (e.g. "Why us?"). */
  label?: string;
  /** Loose page context the adapter or content script extracted. */
  job?: { company?: string; role?: string; jobUrl?: string };
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
  if (settings.provider === 'none' || !settings.apiKey) {
    yield {
      kind: 'error',
      message: 'No AI provider configured. Open Options → AI to add a key.',
    };
    return;
  }

  const prompt = buildPrompt(req, profile, resume);

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

const RESUME_CHAR_BUDGET = 6000; // generous, but bounded; cheap models care

/**
 * Build the prompt sent to the provider. Exposed for tests + reuse.
 *
 * System: writing-assistant role + constraints (first person, length, no
 * hallucinated facts).
 * User: question + label + job context + profile summary + resume excerpt.
 */
export function buildPrompt(
  req: SuggestRequest,
  profile: Profile,
  resume: ResumeRecord | null,
): BuiltPrompt {
  const lengthHint = req.maxChars
    ? ` Keep the response under ${req.maxChars} characters.`
    : ' Keep the response to 2-4 short paragraphs.';

  const system = [
    'You are helping the user draft an answer to a job application question.',
    'Write in the first person, in the user\'s authentic voice — direct, specific, no hype.',
    'Ground every claim in details from the profile or résumé below. Do not invent companies, dates, titles, or skills.',
    'If the profile lacks enough detail to answer well, write a short honest placeholder rather than fabricating.',
    `Match the question's tone.${lengthHint}`,
    'Return only the answer text — no preamble, no quotes, no markdown headings.',
  ].join(' ');

  const profileSummary = summarizeProfile(profile);
  const resumeText = resume ? extractResumeText(resume) : '';
  const job =
    req.job && (req.job.company || req.job.role)
      ? `Applying for ${req.job.role ?? 'a role'}${req.job.company ? ` at ${req.job.company}` : ''}.`
      : '';

  const userParts = [
    job,
    req.label ? `Question label: ${req.label}` : '',
    `Question: ${req.question}`,
    '',
    'Profile:',
    profileSummary || '(empty)',
    '',
  ];
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

/**
 * Best-effort plaintext from the stored résumé. PDFs / DOCXs are stored as
 * base64 bytes — without a parser we'd send binary noise. So: only inline
 * the bytes when the MIME is `text/plain`. For other types we hand the
 * model the filename + a note; the user's typed profile summary carries the
 * rest. (A future step could add pdf.js / mammoth here.)
 */
export function extractResumeText(resume: ResumeRecord): string {
  if (resume.mimeType === 'text/plain') {
    try {
      const binary = atob(resume.bytesBase64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
      return truncate(text.trim(), RESUME_CHAR_BUDGET);
    } catch {
      // fall through
    }
  }
  return `(${resume.filename}, ${resume.mimeType || 'binary'}, ${resume.size} bytes — text extraction not implemented for this type)`;
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
