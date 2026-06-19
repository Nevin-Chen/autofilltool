import { describe, expect, it } from 'vitest';
import {
  buildPrompt,
  extractResumeText,
  estimateTokens,
} from '@/ai/client';
import { emptyProfile, type ResumeRecord } from '@/profile/schema';
import { bytesToBase64 } from '@/profile/resume';

function resumeFromText(txt: string, filename = 'cv.txt'): ResumeRecord {
  const bytes = new TextEncoder().encode(txt);
  return {
    filename,
    mimeType: 'text/plain',
    size: bytes.byteLength,
    bytesBase64: bytesToBase64(bytes),
    uploadedAt: new Date().toISOString(),
  };
}

describe('buildPrompt', () => {
  it('includes question, label, and job context', async () => {
    const { system, user } = await buildPrompt(
      {
        question: 'Why are you interested in this role?',
        label: 'Why us?',
        job: { company: 'Stripe', role: 'Senior Engineer' },
      },
      null,
    );

    expect(system).toMatch(/first person/);
    expect(system).toMatch(/Do not invent or infer them/);
    expect(user).toMatch(/Senior Engineer/);
    expect(user).toMatch(/Stripe/);
    expect(user).toMatch(/Why us\?/);
    expect(user).toMatch(/Why are you interested in this role\?/);
  });

  it('grounds the candidate section in the résumé only, never the profile', async () => {
    const { user } = await buildPrompt(
      {
        question: 'Tell me about yourself.',
      },
      resumeFromText('Ada Lovelace — Senior Engineer at Stripe.'),
    );
    expect(user).toMatch(/=== ABOUT THE CANDIDATE ===/);
    expect(user).toMatch(/Ada Lovelace/);
    expect(user).not.toMatch(/^Profile:/m);
  });

  it('inlines text resume bytes verbatim', async () => {
    const txt = 'Ada Lovelace — Senior Engineer at Stripe. Built X, shipped Y.';
    const bytes = new TextEncoder().encode(txt);
    const resume: ResumeRecord = {
      filename: 'cv.txt',
      mimeType: 'text/plain',
      size: bytes.byteLength,
      bytesBase64: bytesToBase64(bytes),
      uploadedAt: new Date().toISOString(),
    };
    const text = await extractResumeText(resume);
    expect(text).toBe(txt);
  });

  it('returns a placeholder note for an unparseable PDF', async () => {
    const resume: ResumeRecord = {
      filename: 'cv.pdf',
      mimeType: 'application/pdf',
      size: 1234,
      bytesBase64: 'AAAA',
      uploadedAt: new Date().toISOString(),
    };
    const text = await extractResumeText(resume);
    expect(text).toMatch(/cv\.pdf/);
    expect(text).toMatch(/unsupported|extraction/i);
  });

  it('passes the maxChars hint through to the system prompt', async () => {
    const { system } = await buildPrompt(
      { question: 'q', maxChars: 200 },
      null,
    );
    expect(system).toMatch(/under 200 characters/);
  });

  it('inlines the jobDescription under the JOB POSTING section', async () => {
    const { user, system } = await buildPrompt(
      {
        question: 'Tell us about a time you led a team.',
        jobDescription:
          'About the role: Lead a small engineering team. Requirements: 5+ years management.',
      },
      null,
    );
    expect(user).toMatch(/=== JOB POSTING ===/);
    expect(user).toMatch(/Job description:/);
    expect(user).toMatch(/Lead a small engineering team/);
    expect(user).toMatch(/Requirements: 5\+ years management/);
    expect(system).toMatch(/Mirror relevant vocabulary from JOB POSTING/);
  });

  it('renders the question subtext under the TASK section', async () => {
    const { user, system } = await buildPrompt(
      {
        question: 'Why do you want to work here?',
        description:
          'Be specific. Name a particular project and keep it under 200 words.',
      },
      null,
    );
    expect(user).toMatch(/=== TASK ===/);
    expect(user).toMatch(/Additional instructions for this question:/);
    expect(user).toMatch(/Name a particular project and keep it under 200 words/);
    expect(system).toMatch(/Follow every instruction in TASK/);
    expect(system).toMatch(/answer each one/);
  });

  it('omits the additional-instructions block when no subtext is present', async () => {
    const { user } = await buildPrompt({ question: 'Why us?' }, null);
    expect(user).not.toMatch(/Additional instructions for this question:/);
  });

  it('clips overlong question subtext defensively', async () => {
    const big = 'B'.repeat(4000);
    const { user } = await buildPrompt(
      { question: 'q', description: big },
      null,
    );
    expect(user).not.toMatch(/B{900}/);
    expect(user).toMatch(/B+…/);
  });

  it('orders sections candidate → posting → task with the question last', async () => {
    const { user } = await buildPrompt(
      {
        question: 'Why us?',
        jobDescription: 'About the role: Build storage systems.',
        job: { company: 'Stripe', role: 'Senior Engineer' },
      },
      resumeFromText('Ada Lovelace — Senior Engineer at Stripe.'),
    );
    const candidate = user.indexOf('=== ABOUT THE CANDIDATE ===');
    const posting = user.indexOf('=== JOB POSTING ===');
    const task = user.indexOf('=== TASK ===');
    const question = user.indexOf('Question: Why us?');
    expect(candidate).toBeGreaterThan(-1);
    expect(posting).toBeGreaterThan(candidate);
    expect(task).toBeGreaterThan(posting);
    expect(question).toBeGreaterThan(task);
  });

  it('strictly partitions candidate vs posting in the system prompt', async () => {
    const { system } = await buildPrompt({ question: 'q' }, null);
    expect(system).toMatch(/ABOUT THE CANDIDATE/);
    expect(system).toMatch(/JOB POSTING/);
    expect(system).not.toMatch(
      /Ground every claim in details from the profile, résumé, or job description/,
    );
    expect(system).toMatch(
      /every specific claim about the user.*MUST be present in ABOUT THE CANDIDATE/,
    );
    expect(system).toMatch(/the user's résumé/);
  });

  it('bans the obvious AI tells and em dashes in the voice rules', async () => {
    const { system } = await buildPrompt({ question: 'q' }, null);
    expect(system).toMatch(/Banned vocabulary/);
    expect(system).toMatch(/delve/);
    expect(system).toMatch(/leverage/);
    expect(system).toMatch(/seamless/);
    expect(system).toMatch(/Do not use em dashes/);
    expect(system).toMatch(/Never wrap résumé content in quotation marks/);

    expect(system).not.toMatch(/—/);
  });

  it('routes each question type to the right résumé section and adds a motivation case', async () => {
    const { system } = await buildPrompt({ question: 'q' }, null);
    expect(system).toMatch(/For behavioural questions[^.]*## EXPERIENCE/);
    expect(system).toMatch(/For technology questions[^.]*## SKILLS/);
    expect(system).toMatch(/For education questions[^.]*## EDUCATION/);
    expect(system).toMatch(/For motivation questions[^.]*why this role[^.]*why this company/);
    expect(system).toMatch(/Do not summarize the entire résumé/);
    expect(system).toMatch(/do not copy large portions of JOB POSTING/);
  });

  it('clips an overlong jobDescription to ~3000 chars defensively', async () => {
    const big = 'A'.repeat(10_000);
    const { user } = await buildPrompt(
      { question: 'q', jobDescription: big },
      null,
    );
    expect(user).not.toMatch(/A{4000}/);
    expect(user).toMatch(/A+…/);
  });

  it('omits the job description body when nothing was extracted', async () => {
    const { user } = await buildPrompt({ question: 'q' }, null);
    expect(user).not.toMatch(/Job description:/);
  });

  it('marks the résumé as missing when none was uploaded', async () => {
    const { user } = await buildPrompt({ question: 'q' }, null);
    expect(user).toMatch(/Résumé: \(none uploaded\)/);
  });
});

describe('estimateTokens', () => {
  it('uses an uncapped default (8192) when no maxChars hint is given', () => {
    expect(estimateTokens(undefined)).toBe(8192);
  });

  it('honours a textarea maxLength as a soft target and clamps at 8192', () => {
    expect(estimateTokens(3000)).toBe(1000);
    expect(estimateTokens(20_000)).toBe(Math.round(20_000 / 3));
    expect(estimateTokens(100_000)).toBe(8192);
  });

  it('floors small fields at 512 tokens so short maxChars never starve the model', () => {
    expect(estimateTokens(10)).toBe(512);
    expect(estimateTokens(500)).toBe(512);
  });
});

describe('buildPrompt anti-hallucination kill switch', () => {
  it('emits an explicit refusal directive when no résumé is attached', async () => {
    const { system } = await buildPrompt(
      { question: 'Tell us about a time you led a team.' },
      null,
    );
    expect(system).toMatch(/ABOUT THE CANDIDATE is empty/);
    expect(system).toMatch(/Do NOT fabricate/);
    expect(system).toMatch(/upload a résumé in the autofilltool options/);
  });

  it('does not consider saved profile fields when deciding if candidate is sparse', async () => {
    const p = emptyProfile();
    p.firstName = 'Ada';
    p.lastName = 'Lovelace';
    p.links.linkedin = 'https://linkedin.com/in/ada';
    void p;
    const { system } = await buildPrompt({ question: 'q' }, null);
    expect(system).toMatch(/ABOUT THE CANDIDATE is empty/);
  });

  it('omits the hard refusal when a résumé has actual content', async () => {
    const { system } = await buildPrompt(
      { question: 'q' },
      resumeFromText('Ada Lovelace — Senior Engineer at Stripe.'),
    );
    expect(system).not.toMatch(/ABOUT THE CANDIDATE is empty/);
    expect(system).toMatch(/Do not invent or infer them/);
  });

  it('does not false-positive a parsed résumé that starts with a parenthetical', async () => {
    for (const opener of ['(415) 555-1234 | Ada Lovelace', '(she/her) Ada Lovelace']) {
      const { system } = await buildPrompt(
        { question: 'q' },
        resumeFromText(`${opener}\nSenior Engineer at Stripe.`),
      );
      expect(system).not.toMatch(/ABOUT THE CANDIDATE is empty/);
    }
  });
});
