import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  sharedConfirmed,
  isSubmissionConfirmed,
  installSubmitWatch,
  maybeLogPostNavigation,
  __resetSubmitWatchForTests,
} from '@/content/submit-watch';
import type { PlatformAdapter } from '@/adapters/types';

const adapter: PlatformAdapter = {
  id: 'greenhouse',
  name: 'Greenhouse',
  matches: () => true,
  detectFields: () => [],
  getJobDescription: () => '',
};

const ctx = {
  company: 'Stripe',
  role: 'Engineer',
  jobUrl: 'http://localhost/jobs/1',
  jobDescription: '',
};

const flush = () => new Promise((r) => setTimeout(r, 0));

let sendMessage: ReturnType<typeof vi.fn>;
let sessionStore: Record<string, unknown>;

beforeEach(() => {
  __resetSubmitWatchForTests();
  document.documentElement.innerHTML = '<head></head><body></body>';
  sessionStore = {};
  sendMessage = vi.fn(async () => ({
    ok: true,
    value: { stored: true, posted: true, record: {} },
  }));

  (globalThis as any).chrome = {
    runtime: { sendMessage },
    storage: {
      session: {
        set: vi.fn(async (obj: Record<string, unknown>) => {
          Object.assign(sessionStore, obj);
        }),
        remove: vi.fn(async (key: string) => {
          delete sessionStore[key];
        }),
        get: vi.fn(async (key: string) => ({ [key]: sessionStore[key] })),
      },
    },
  };
});

const CONFIRM_HTML = '<h1>Thank you for applying!</h1><p>Your application was submitted.</p>';

describe('sharedConfirmed', () => {
  it('true on a confirmation phrase with no open submit control', () => {
    document.body.innerHTML = CONFIRM_HTML;
    expect(sharedConfirmed(document)).toBe(true);
  });

  it('false when a submit button is still present', () => {
    document.body.innerHTML = CONFIRM_HTML + '<button>Submit Application</button>';
    expect(sharedConfirmed(document)).toBe(false);
  });

  it('false with no confirmation phrase', () => {
    document.body.innerHTML = '<form><input name="email" /></form>';
    expect(sharedConfirmed(document)).toBe(false);
  });
});

describe('isSubmissionConfirmed', () => {
  it('prefers the adapter hook when provided', () => {
    const withHook: PlatformAdapter = {
      ...adapter,
      detectSubmissionConfirmed: () => true,
    };

    expect(isSubmissionConfirmed(withHook, document, new URL('http://localhost/'))).toBe(true);
  });

  it('falls back to the shared heuristic when the hook throws', () => {
    document.body.innerHTML = CONFIRM_HTML;
    const throwing: PlatformAdapter = {
      ...adapter,
      detectSubmissionConfirmed: () => {
        throw new Error('boom');
      },
    };
    expect(isSubmissionConfirmed(throwing, document, new URL('http://localhost/'))).toBe(true);
  });
});

describe('installSubmitWatch', () => {
  it('fires LOG_SUBMISSION once after a real submit attempt + confirmation', async () => {
    document.body.innerHTML = '<form><button>Submit Application</button></form>';
    installSubmitWatch({ adapter, ctx });

    document.querySelector('button')!.dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    );

    document.body.innerHTML = CONFIRM_HTML;
    history.pushState({}, '', '/applied');
    await flush();

    expect(sendMessage).toHaveBeenCalledTimes(1);
    const msg = sendMessage.mock.calls[0]![0] as {
      type: string;
      record: { status: string; source: string; company: string };
    };
    expect(msg.type).toBe('LOG_SUBMISSION');
    expect(msg.record.status).toBe('submitted');
    expect(msg.record.source).toBe('greenhouse');
    expect(msg.record.company).toBe('Stripe');

    history.pushState({}, '', '/applied2');
    await flush();
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it('does not fire when the user never attempted to submit', async () => {
    installSubmitWatch({ adapter, ctx });
    document.body.innerHTML = CONFIRM_HTML;
    history.pushState({}, '', '/applied');
    await flush();
    expect(sendMessage).not.toHaveBeenCalled();
  });
});

describe('maybeLogPostNavigation', () => {
  it('logs from a recent same-host breadcrumb on a confirmation page', async () => {
    sessionStore['autofilltool:lastFill'] = {
      jobUrl: 'http://localhost/jobs/1',
      company: 'Stripe',
      role: 'Engineer',
      adapterId: 'lever',
      at: Date.now(),
    };
    document.body.innerHTML = CONFIRM_HTML;
    await maybeLogPostNavigation(adapter, document, new URL('http://localhost/applied'));
    expect(sendMessage).toHaveBeenCalledTimes(1);
    const msg = sendMessage.mock.calls[0]![0] as { record: { source: string } };
    expect(msg.record.source).toBe('lever');
  });

  it('no-op without a breadcrumb', async () => {
    document.body.innerHTML = CONFIRM_HTML;
    await maybeLogPostNavigation(adapter, document, new URL('http://localhost/applied'));
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('no-op when the breadcrumb is stale', async () => {
    sessionStore['autofilltool:lastFill'] = {
      jobUrl: 'http://localhost/jobs/1',
      company: 'Stripe',
      role: 'Engineer',
      adapterId: 'lever',
      at: Date.now() - 11 * 60 * 1000,
    };
    document.body.innerHTML = CONFIRM_HTML;
    await maybeLogPostNavigation(adapter, document, new URL('http://localhost/applied'));
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
