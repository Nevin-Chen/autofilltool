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
  it('includes question, label, profile summary, and job context', () => {
    const p = emptyProfile();
    p.firstName = 'Ada';
    p.lastName = 'Lovelace';

    const { system, user } = buildPrompt(
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

  it('inlines text resume bytes verbatim', () => {
    const txt = 'Ada Lovelace — Senior Engineer at Acme. Built X, shipped Y.';
    const bytes = new TextEncoder().encode(txt);
    const resume: ResumeRecord = {
      filename: 'cv.txt',
      mimeType: 'text/plain',
      size: bytes.byteLength,
      bytesBase64: bytesToBase64(bytes),
      uploadedAt: new Date().toISOString(),
    };
    const text = extractResumeText(resume);
    expect(text).toBe(txt);
  });

  it('skips binary resumes with a placeholder note', () => {
    const resume: ResumeRecord = {
      filename: 'cv.pdf',
      mimeType: 'application/pdf',
      size: 1234,
      bytesBase64: 'AAAA',
      uploadedAt: new Date().toISOString(),
    };
    const text = extractResumeText(resume);
    expect(text).toMatch(/cv\.pdf/);
    expect(text).toMatch(/not implemented/i);
  });

  it('passes the maxChars hint through to the system prompt', () => {
    const { system } = buildPrompt(
      { question: 'q', maxChars: 200 },
      emptyProfile(),
      null,
    );
    expect(system).toMatch(/under 200 characters/);
  });
});
