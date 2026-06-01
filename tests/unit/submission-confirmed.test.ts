import { describe, expect, it, beforeEach } from 'vitest';
import { greenhouseAdapter } from '@/adapters/greenhouse';
import { leverAdapter } from '@/adapters/lever';
import { ashbyAdapter } from '@/adapters/ashby';
import { workdayAdapter } from '@/adapters/workday';

beforeEach(() => {
  document.documentElement.innerHTML = '<head></head><body></body>';
});

const THANKS = '<h1>Thank you for applying!</h1><p>Your application was submitted.</p>';

describe('greenhouse.detectSubmissionConfirmed', () => {
  const det = greenhouseAdapter.detectSubmissionConfirmed!;
  const url = new URL('https://boards.greenhouse.io/acme/jobs/1');

  it('true on the legacy confirmation region', () => {
    document.body.innerHTML = '<div id="application_confirmation">Thanks!</div>';
    expect(det(document, url)).toBe(true);
  });

  it('true when the form is gone and confirmation copy is present', () => {
    document.body.innerHTML = THANKS;
    expect(det(document, url)).toBe(true);
  });

  it('false while the application form is still present', () => {
    document.body.innerHTML = THANKS + '<form id="application-form"></form>';
    expect(det(document, url)).toBe(false);
  });
});

describe('lever.detectSubmissionConfirmed', () => {
  const det = leverAdapter.detectSubmissionConfirmed!;

  it('true on the /thanks route', () => {
    document.body.innerHTML = '<div>anything</div>';
    expect(det(document, new URL('https://jobs.lever.co/acme/123/thanks'))).toBe(true);
  });

  it('true when the apply form is gone and confirmation copy is present', () => {
    document.body.innerHTML = THANKS;
    expect(det(document, new URL('https://jobs.lever.co/acme/123'))).toBe(true);
  });

  it('false while the apply form is present', () => {
    document.body.innerHTML = THANKS + '<form action="https://jobs.lever.co/acme/123/apply"></form>';
    expect(det(document, new URL('https://jobs.lever.co/acme/123/apply'))).toBe(false);
  });
});

describe('ashby.detectSubmissionConfirmed', () => {
  const det = ashbyAdapter.detectSubmissionConfirmed!;
  const url = new URL('https://jobs.ashbyhq.com/acme/123');

  it('true when FieldEntry blocks are gone and confirmation copy is present', () => {
    document.body.innerHTML = THANKS;
    expect(det(document, url)).toBe(true);
  });

  it('false while FieldEntry blocks remain', () => {
    document.body.innerHTML = THANKS + '<div data-testid="FieldEntry"></div>';
    expect(det(document, url)).toBe(false);
  });
});

describe('workday.detectSubmissionConfirmed', () => {
  const det = workdayAdapter.detectSubmissionConfirmed!;
  const url = new URL('https://acme.myworkdayjobs.com/careers/job/1/apply');

  it('true on the confirmation automation-id', () => {
    document.body.innerHTML = '<div data-automation-id="confirmationPage"></div>';
    expect(det(document, url)).toBe(true);
  });

  it('true on confirmation copy fallback', () => {
    document.body.innerHTML = THANKS;
    expect(det(document, url)).toBe(true);
  });

  it('false on an ordinary wizard page', () => {
    document.body.innerHTML = '<div data-automation-id="firstName"></div>';
    expect(det(document, url)).toBe(false);
  });
});
