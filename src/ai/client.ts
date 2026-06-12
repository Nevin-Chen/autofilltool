import type { Profile, AiSettings, ResumeRecord } from '@/profile/schema';
import { streamOpenAI, OPENAI_DEFAULT_MODEL } from './providers/openai';
import { streamAnthropic, ANTHROPIC_DEFAULT_MODEL } from './providers/anthropic';
import { streamGemini, GEMINI_DEFAULT_MODEL } from './providers/gemini';
import { streamOllama, OLLAMA_DEFAULT_MODEL } from './providers/ollama';
import { extractResumeText, isResumePlaceholder } from './resume-text';
import { log } from '@/lib/logger';

export { extractResumeText };

export type SuggestRequest = {
  question: string;
  label?: string;
  job?: { company?: string; role?: string; jobUrl?: string };
  jobDescription?: string;
  maxChars?: number;
};

export type StreamEvent =
  | { kind: 'delta'; text: string }
  | { kind: 'done' }
  | { kind: 'error'; message: string };

export async function* dispatch(
  req: SuggestRequest,
  settings: AiSettings,
  resume: ResumeRecord | null,
): AsyncGenerator<StreamEvent, void, unknown> {
  if (settings.provider === 'none') {
    yield {
      kind: 'error',
      message: 'No AI provider configured. Open Options → AI to add a key.',
    };
    return;
  }
  if (settings.provider !== 'ollama' && !settings.apiKey) {
    yield {
      kind: 'error',
      message: 'No AI provider configured. Open Options → AI to add a key.',
    };
    return;
  }

  const prompt = await buildPrompt(req, resume);

  try {
    const maxTokens = estimateTokens(req.maxChars);
    if (settings.provider === 'openai') {
      const model = settings.model || OPENAI_DEFAULT_MODEL;
      for await (const text of streamOpenAI({
        apiKey: settings.apiKey,
        model,
        system: prompt.system,
        user: prompt.user,
        maxTokens,
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
        maxTokens,
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
        maxTokens,
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
        maxTokens,
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

export type BuiltPrompt = { system: string; user: string };

const JOB_DESCRIPTION_PROMPT_BUDGET = 3000;

export async function buildPrompt(
  req: SuggestRequest,
  resume: ResumeRecord | null,
): Promise<BuiltPrompt> {
  const lengthHint = req.maxChars
    ? ` Keep the response under ${req.maxChars} characters.`
    : ' Keep the response to 2-4 short paragraphs.';

  const resumeText = resume ? await extractResumeText(resume) : '';
  const jobDescription = req.jobDescription
    ? truncate(req.jobDescription.trim(), JOB_DESCRIPTION_PROMPT_BUDGET)
    : '';
  const job =
    req.job && (req.job.company || req.job.role)
      ? `Applying for ${req.job.role ?? 'a role'}${req.job.company ? ` at ${req.job.company}` : ''}.`
      : '';

  const resumeIsPlaceholder = !!resumeText && isResumePlaceholder(resumeText);
  const hasResumeContent = !!resumeText && !resumeIsPlaceholder;
  const candidateIsSparse = !hasResumeContent;

  const baseRules = [
    'You are helping the user draft an answer to a job application question.',
    "Write in the first person, in the user's authentic voice, direct, specific, no hype.",
    'The prompt has three sections marked with === HEADERS ===: ABOUT THE CANDIDATE (the user\'s résumé), JOB POSTING (what the employer wrote), and TASK (the question to answer).',
    'Hard rule: every specific claim about the user (companies, dates, titles, technologies, metrics, projects) MUST come verbatim from ABOUT THE CANDIDATE. You are forbidden from inventing companies, titles, dates, employers, products, or projects. You are forbidden from importing facts out of JOB POSTING into the answer as if they were the user\'s own experience. If a fact is not in ABOUT THE CANDIDATE, you do not have it.',
    'The résumé inside ABOUT THE CANDIDATE may be split into labelled sections (## CONTACT, ## SUMMARY, ## EXPERIENCE, ## SKILLS, ## PROJECTS, ## EDUCATION, ...). Mine the section that matches the question: behavioural prompts → ## EXPERIENCE, technology questions → ## SKILLS, education prompts → ## EDUCATION. Quote the user\'s own phrasing, company names, role titles, metrics, technologies, verbatim.',
    'When the job description mentions specific responsibilities, qualifications, or values, mirror that vocabulary in your answer, but only when the user\'s actual experience supports it.',
  ];
  const sparseRule = candidateIsSparse
    ? 'ABOUT THE CANDIDATE is empty (no parseable résumé attached). Do NOT fabricate any experience, employer, role, or project. Return exactly this line and stop: [Please upload a résumé in the autofilltool options, then click Suggest again.]'
    : 'If the résumé genuinely lacks the specifics needed for this particular question, write a brief honest answer that uses only what IS there rather than fabricating new facts.';
  const closingRules = [
    sparseRule,
    `Match the question's tone.${lengthHint}`,
    'Return only the answer text, no preamble, no quotes, no markdown headings.',
  ];
  const system = [...baseRules, ...closingRules].join(' ');

  const userParts: string[] = [];

  userParts.push('=== ABOUT THE CANDIDATE ===');
  if (resumeText) {
    userParts.push('', 'Résumé:', resumeText);
  } else {
    userParts.push('', 'Résumé: (none uploaded)');
  }

  userParts.push('', '=== JOB POSTING ===');
  if (job) userParts.push('', job);
  if (jobDescription) {
    userParts.push('', 'Job description:', jobDescription);
  } else if (!job) {
    userParts.push('', '(no job posting context available)');
  }

  userParts.push('', '=== TASK ===');
  if (req.label) userParts.push('', `Question label: ${req.label}`);
  userParts.push('', `Question: ${req.question}`);

  userParts.push(
    '',
    'Write the answer now. Anchor every specific claim (companies, titles, dates, projects, technologies, metrics) in ABOUT THE CANDIDATE. Use JOB POSTING only to choose which of the candidate\'s experiences to highlight and which vocabulary to mirror.',
  );

  const user = userParts.join('\n');

  log.debug('Suggest prompt built', {
    question: req.question.slice(0, 80),
    resumeChars: resumeText.length,
    resumeIsPlaceholder,
    resumeSections: countResumeSections(resumeText),
    resumeHead: resumeText.slice(0, 240),
    jdChars: jobDescription.length,
    candidateIsSparse,
    userChars: user.length,
  });

  return { system, user };
}

function countResumeSections(resumeText: string): number {
  const matches = resumeText.match(/^## [A-Z]+/gm);
  return matches ? matches.length : 0;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + '…';
}

export function estimateTokens(maxChars: number | undefined): number {
  const UNCAPPED = 8192;
  if (!maxChars) return UNCAPPED;
  const target = Math.round(maxChars / 3);
  return Math.max(512, Math.min(UNCAPPED, target));
}

export type ClassifyRequest = {
  question: string;
  fieldType: 'text' | 'textarea' | 'radio' | 'select' | 'combobox';
  options?: string[];
  jobDescription?: string;
  job?: { company?: string; role?: string; jobUrl?: string };
  wasClassified?: boolean;
};

export type BuiltClassifyPrompt = { system: string; user: string };

export function buildClassifyPrompt(
  req: ClassifyRequest,
  profile: Profile,
  opts: { mode?: 'strict' | 'preference' } = {},
): BuiltClassifyPrompt {
  const profileSummary = summarizeProfileForClassifier(profile);
  const mode = opts.mode ?? 'strict';

  const optionsBlock = (() => {
    if (!req.options || req.options.length === 0) return '';
    const lines = req.options.map((o) => `- ${o}`).join('\n');
    if (mode === 'preference') {
      return `\nAvailable options (you MUST return one of these verbatim):\n${lines}\n`;
    }
    return `\nAvailable options (you MUST return one of these verbatim, or "SKIP"):\n${lines}\n`;
  })();

  const formatHint = (() => {
    switch (req.fieldType) {
      case 'radio':
      case 'select':
      case 'combobox':
        return mode === 'preference'
          ? 'Reply with ONLY the exact text of one option from the list above, copied verbatim. No quotes, no explanation, no leading bullet, no markdown.'
          : 'Reply with ONLY the exact text of one option from the list above, copied verbatim. No quotes, no explanation, no leading bullet, no markdown. If none apply, reply with the single word: SKIP';
      case 'textarea':
        return 'Return a short paragraph (1-3 sentences). Plain text only.';
      case 'text':
      default:
        return mode === 'preference'
          ? 'Return a single short value (a word or short phrase) that a typical candidate would put here. Plain text only, no surrounding quotes.'
          : 'Return a single short value (a word or short phrase). Plain text only, no surrounding quotes.';
    }
  })();

  const system =
    mode === 'preference'
      ? [
          'YOU MUST ANSWER THIS QUESTION. The user is filling out a job application and every field needs a value. Pick the most reasonable answer that a typical candidate would give.',
          'Reply with ONLY the value (or the exact text of one option if a list is provided). No explanation, no preamble, no apologies, no markdown.',
          'A blank profile is the COMMON case for preference questions (timing, availability, work mode, sourcing channel, scheduling). Pick a sensible default; do not refuse. Examples:',
          ' - "earliest start date" → "Immediately" (or the closest equivalent on the list)',
          ' - "open to in-person work" → "Yes"',
          ' - "how did you hear about us" → "LinkedIn" or "Company website"',
          ' - "any deadlines or timeline considerations" → "None at this time"',
          ' - "how do you pronounce your name" → a phonetic spelling derived from the name in the profile, e.g. "Nevin" → "NEH-vin"',
          'Never fabricate personal data (name, email, address, employer history, real LinkedIn/portfolio URLs). For those specific fields, if the profile is empty, reply SKIP. Reasonable preference defaults are NOT fabrication.',
        ].join(' ')
      : [
          'You are filling out a job application form for the user. Your job is to pick the right value for ONE form field based on the user\'s saved profile.',
          'Reply with ONLY the value to put in the field. No explanation, no preamble, no markdown.',
          'If the profile does not contain enough information to answer, reply with the single word: SKIP',
          'Never fabricate personal information (name, email, address, work history). If a fact is not in the profile, reply SKIP.',
        ].join(' ');

  const user = [
    `Form field type: ${req.fieldType}`,
    `Question: ${req.question}`,
    optionsBlock,
    'User profile:',
    profileSummary || '(empty profile)',
    '',
    formatHint,
  ]
    .filter(Boolean)
    .join('\n');

  return { system, user };
}

export function parseClassifyResponse(
  raw: string,
  fieldType?: ClassifyRequest['fieldType'],
  options?: string[],
): string | null {
  if (!raw) return null;
  if (fieldType === 'textarea') {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    if (/^skip\.?$/i.test(trimmed)) return null;
    const stripped = trimmed.replace(/^"([\s\S]*)"$/, '$1').trim();
    return stripped.length > 0 ? stripped : null;
  }
  if (options && options.length > 0) {
    const matched = findOptionInResponse(raw, options);
    if (matched) return matched;
  }
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length === 0) return null;
  let line = lines[0]!;
  line = line.replace(/^["'`]+|["'`]+$/g, '').trim();
  // The model was instructed to reply SKIP when it can't answer.
  if (/^skip$/i.test(line)) return null;
  if (line.length === 0) return null;
  return line;
}

function findOptionInResponse(raw: string, options: string[]): string | null {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim().replace(/^["'`*\-•·]+\s*|[\s"'`.,;:]+$/g, '').trim())
    .filter((l) => l.length > 0);
  for (const line of lines) {
    const lower = line.toLowerCase();
    if (lower === 'skip' || lower === 'skip.') continue;
    for (const opt of options) {
      if (opt.trim().toLowerCase() === lower) return opt;
    }
  }
  const lowerRaw = raw.toLowerCase();
  const hits = options.filter((opt) => {
    const o = opt.trim().toLowerCase();
    if (!o) return false;
    return new RegExp(`(?:^|\\W)${escapeRegExpLocal(o)}(?:\\W|$)`, 'i').test(lowerRaw);
  });
  if (hits.length === 1) return hits[0]!;
  return null;
}

function escapeRegExpLocal(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function summarizeProfileForClassifier(profile: Profile): string {
  const lines: string[] = [];
  const push = (k: string, v: string | null | undefined): void => {
    if (v && v.toString().trim()) lines.push(`- ${k}: ${v}`);
  };

  push('First name', profile.firstName);
  push('Last name', profile.lastName);
  push('Preferred name', profile.preferredName);
  push('Email', profile.email);
  push('Phone', profile.phone);

  push('Address line 1', profile.address.line1);
  push('Address line 2', profile.address.line2);
  push('City', profile.address.city);
  push('State/Region', profile.address.region);
  push('Postal code', profile.address.postalCode);
  push('Country', profile.address.country);

  push('LinkedIn', profile.links.linkedin);
  push('GitHub', profile.links.github);
  push('Portfolio', profile.links.portfolio);
  push('Twitter', profile.links.twitter);
  push('Other link', profile.links.other);

  if (profile.workAuth.authorizedToWorkInUS !== null) {
    push('Authorized to work in US', profile.workAuth.authorizedToWorkInUS ? 'Yes' : 'No');
  }
  if (profile.workAuth.requiresSponsorship !== null) {
    push('Requires sponsorship', profile.workAuth.requiresSponsorship ? 'Yes' : 'No');
  }
  if (profile.workAuth.willingToRelocate !== null) {
    push('Willing to relocate', profile.workAuth.willingToRelocate ? 'Yes' : 'No');
  }
  push('Desired salary', profile.workAuth.desiredSalary);

  push('Gender', profile.demographics.gender);
  push('Pronouns', profile.demographics.pronouns);
  push('Ethnicity', profile.demographics.ethnicity);
  push('Race', profile.demographics.race);
  push('Veteran status', profile.demographics.veteranStatus);
  push('Disability status', profile.demographics.disabilityStatus);

  return lines.join('\n');
}

export async function classifyField(
  req: ClassifyRequest,
  settings: AiSettings,
  profile: Profile,
  resume: ResumeRecord | null = null,
): Promise<string | null> {
  if (settings.provider === 'none') return null;
  if (settings.provider !== 'ollama' && !settings.apiKey) return null;

  const useWritingPrompt =
    req.fieldType === 'textarea' && (req.jobDescription || resume);
  if (useWritingPrompt) {
    const prompt = await buildPrompt(
      {
        question: req.question,
        label: req.question,
        ...(req.job ? { job: req.job } : {}),
        ...(req.jobDescription ? { jobDescription: req.jobDescription } : {}),
      },
      resume,
    );
    return classifyDirect(prompt, settings, {
      fieldType: 'textarea',
      maxTokens: 800,
    });
  }
  const prompt = buildClassifyPrompt(req, profile, { mode: pickClassifyMode(req) });
  return classifyDirect(prompt, settings, {
    fieldType: req.fieldType,
    ...(req.options ? { options: req.options } : {}),
  });
}

function pickClassifyMode(req: ClassifyRequest): 'strict' | 'preference' {
  if (req.wasClassified !== false) return 'strict';

  const opts = req.options ?? [];
  if (
    (req.fieldType === 'radio' || req.fieldType === 'select' || req.fieldType === 'combobox') &&
    opts.length >= 2 &&
    opts.length <= 30
  ) {
    return 'preference';
  }
  if (req.fieldType === 'text') return 'preference';

  return 'strict';
}

async function classifyDirect(
  prompt: BuiltClassifyPrompt,
  settings: AiSettings,
  opts: {
    fieldType?: ClassifyRequest['fieldType'];
    maxTokens?: number;
    options?: string[];
  } = {},
): Promise<string | null> {
  try {
    let accumulated = '';
    const maxTokens = opts.maxTokens ?? 200;
    const accumulationCap = opts.fieldType === 'textarea' ? 4000 : 600;
    const temperature = 0;
    if (settings.provider === 'openai') {
      const model = settings.model || OPENAI_DEFAULT_MODEL;
      for await (const text of streamOpenAI({
        apiKey: settings.apiKey,
        model,
        system: prompt.system,
        user: prompt.user,
        maxTokens,
        temperature,
      })) {
        accumulated += text;
        if (accumulated.length > accumulationCap) break;
      }
    } else if (settings.provider === 'anthropic') {
      const model = settings.model || ANTHROPIC_DEFAULT_MODEL;
      for await (const text of streamAnthropic({
        apiKey: settings.apiKey,
        model,
        system: prompt.system,
        user: prompt.user,
        maxTokens,
        temperature,
      })) {
        accumulated += text;
        if (accumulated.length > accumulationCap) break;
      }
    } else if (settings.provider === 'gemini') {
      const model = settings.model || GEMINI_DEFAULT_MODEL;
      for await (const text of streamGemini({
        apiKey: settings.apiKey,
        model,
        system: prompt.system,
        user: prompt.user,
        maxTokens,
        temperature,
      })) {
        accumulated += text;
        if (accumulated.length > accumulationCap) break;
      }
    } else if (settings.provider === 'ollama') {
      const model = settings.model || OLLAMA_DEFAULT_MODEL;
      for await (const text of streamOllama({
        apiKey: settings.apiKey,
        model,
        system: prompt.system,
        user: prompt.user,
        maxTokens,
        temperature,
        endpoint: settings.endpoint,
      })) {
        accumulated += text;
        if (accumulated.length > accumulationCap) break;
      }
    } else {
      return null;
    }
    return parseClassifyResponse(accumulated, opts.fieldType, opts.options);
  } catch (err) {
    void err;
    return null;
  }
}
