import { describe, expect, it } from 'vitest';
import { buildPrompt, summarizeProfile, extractResumeText } from '@/ai/client';
import { emptyProfile, type ResumeRecord } from '@/profile/schema';
import { bytesToBase64 } from '@/profile/resume';

describe('summarizeProfile', () => {
  it('includes name and links when set', () => {
    const p = emptyProfile();
    p.firstName = 'Ada';
    p.lastName = 'Lovelace';
    p.links.linkedin = 'https://linkedin.com/in/ada';
    p.links.github = 'https://github.com/ada';
    const s = summarizeProfile(p);
    expect(s).toMatch(/Ada Lovelace/);
    expect(s).toMatch(/linkedin\.com\/in\/ada/);
    expect(s).toMatch(/github\.com\/ada/);
  });

  it('returns empty string for an empty profile', () => {
    expect(summarizeProfile(emptyProfile())).toBe('');
  });
});

describe('buildPrompt', () => {
  it('includes question, label, profile summary, and job context', async () => {
    const p = emptyProfile();
    p.firstName = 'Ada';
    p.lastName = 'Lovelace';

    const { system, user } = await buildPrompt(
      {
        question: 'Why are you interested in this role?',
        label: 'Why us?',
        job: { company: 'Acme', role: 'Senior Engineer' },
      },
      p,
      null,
    );

    expect(system).toMatch(/first person/);
    expect(system).toMatch(/Do not invent/);
    expect(user).toMatch(/Senior Engineer/);
    expect(user).toMatch(/Acme/);
    expect(user).toMatch(/Why us\?/);
    expect(user).toMatch(/Why are you interested in this role\?/);
    expect(user).toMatch(/Ada Lovelace/);
  });

  it('inlines text resume bytes verbatim', async () => {
    const txt = 'Ada Lovelace — Senior Engineer at Acme. Built X, shipped Y.';
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
    // Tiny garbage bytes — pdfjs will throw and we should fall through
    // to the placeholder so the prompt still builds.
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
      emptyProfile(),
      null,
    );
    expect(system).toMatch(/under 200 characters/);
  });

  it('inlines the jobDescription under a labelled section', async () => {
    const { user, system } = await buildPrompt(
      {
        question: 'Tell us about a time you led a team.',
        jobDescription:
          'About the role: Lead a small engineering team. Requirements: 5+ years management.',
      },
      emptyProfile(),
      null,
    );
    expect(user).toMatch(/Job description \(from the posting\):/);
    expect(user).toMatch(/Lead a small engineering team/);
    expect(user).toMatch(/Requirements: 5\+ years management/);
    expect(system).toMatch(/mirror that vocabulary/);
  });

  it('clips an overlong jobDescription to ~3000 chars defensively', async () => {
    const big = 'A'.repeat(10_000);
    const { user } = await buildPrompt(
      { question: 'q', jobDescription: big },
      emptyProfile(),
      null,
    );
    // The full 10k should NOT all be there; should end with ellipsis.
    expect(user).not.toMatch(/A{4000}/);
    expect(user).toMatch(/A+…/);
  });

  it('omits the job description section when nothing was extracted', async () => {
    const { user } = await buildPrompt(
      { question: 'q' },
      emptyProfile(),
      null,
    );
    expect(user).not.toMatch(/Job description/);
  });
});
