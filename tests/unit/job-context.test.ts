import { describe, expect, it, beforeEach } from 'vitest';
import { extractJobContext } from '@/content/job-context';

beforeEach(() => {
  document.documentElement.innerHTML = '<head></head><body></body>';
});

describe('extractJobContext', () => {
  it('prefers JSON-LD JobPosting', () => {
    document.head.innerHTML = `
      <script type="application/ld+json">
        ${JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'JobPosting',
          title: 'Senior Backend Engineer',
          hiringOrganization: { '@type': 'Organization', name: 'Acme Robotics' },
        })}
      </script>
    `;
    const ctx = extractJobContext(document, new URL('https://example.com/x'));
    expect(ctx.role).toBe('Senior Backend Engineer');
    expect(ctx.company).toBe('Acme Robotics');
  });

  it('falls back to og:title and og:site_name', () => {
    document.head.innerHTML = `
      <meta property="og:title" content="Apply for: Staff SRE" />
      <meta property="og:site_name" content="Globex" />
    `;
    const ctx = extractJobContext(document, new URL('https://example.com/x'));
    expect(ctx.role).toMatch(/Staff SRE/);
    expect(ctx.company).toBe('Globex');
  });

  it('derives company from greenhouse URL', () => {
    document.title = 'Software Engineer | Careers';
    const ctx = extractJobContext(
      document,
      new URL('https://boards.greenhouse.io/widget-co/jobs/12345'),
    );
    expect(ctx.company).toBe('Widget Co');
  });

  it('derives company from lever URL', () => {
    const ctx = extractJobContext(
      document,
      new URL('https://jobs.lever.co/acme-bio/abcd-1234'),
    );
    expect(ctx.company).toBe('Acme Bio');
  });

  it('strips utm tracking params from jobUrl', () => {
    const ctx = extractJobContext(
      document,
      new URL('https://example.com/job?utm_source=linkedin&id=42'),
    );
    expect(ctx.jobUrl).not.toMatch(/utm_/);
    expect(ctx.jobUrl).toMatch(/id=42/);
  });

  it('splits "Role — Company" titles when no other signal exists', () => {
    document.title = 'Lead Designer — Initech';
    const ctx = extractJobContext(document, new URL('https://example.com/x'));
    expect(ctx.role).toBe('Lead Designer');
    expect(ctx.company).toBe('Initech');
  });

  it('prefers the Greenhouse URL path over og:site_name="Embed" inside an iframe', () => {
    // Repro: an embedded Greenhouse iframe sets og:site_name to "Embed", which
    // used to win and surface "Embed" as the company name.
    document.head.innerHTML = `<meta property="og:site_name" content="Embed" />`;
    const ctx = extractJobContext(
      document,
      new URL('https://job-boards.greenhouse.io/spotandtango/jobs/4567'),
    );
    expect(ctx.company).toBe('Spotandtango');
  });

  it('reads the Greenhouse embed widget URL (?for=) instead of the literal /embed/ path', () => {
    document.head.innerHTML = `<meta property="og:site_name" content="Embed" />`;
    const ctx = extractJobContext(
      document,
      new URL('https://boards.greenhouse.io/embed/job_app?for=acme-bio&token=12345'),
    );
    expect(ctx.company).toBe('Acme Bio');
  });

  it('Greenhouse embed widget without ?for= falls through (not "Embed")', () => {
    document.title = 'Senior Eng — Globex';
    const ctx = extractJobContext(
      document,
      new URL('https://boards.greenhouse.io/embed/job_app?token=12345'),
    );
    expect(ctx.company).toBe('Globex');
  });
});
