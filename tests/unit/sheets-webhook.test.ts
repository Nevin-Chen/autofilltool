import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  WebhookUrlSchema,
  postSubmission,
  postTestPing,
} from '@/tracking/sheets-webhook';
import type { SubmissionRecord } from '@/profile/schema';

const sample: SubmissionRecord = {
  id: '00000000-0000-0000-0000-000000000001',
  timestamp: '2026-01-01T00:00:00.000Z',
  company: 'Stripe',
  role: 'Engineer',
  jobUrl: 'https://example.com/jobs/1',
  source: 'generic',
  status: 'submitted',
  note: '',
};

beforeEach(() => {
  (globalThis as any).chrome = {
    permissions: {
      contains: vi.fn(async () => true),
    },
  };
});

describe('WebhookUrlSchema', () => {
  it('rejects http urls', () => {
    expect(WebhookUrlSchema.safeParse('http://example.com').success).toBe(false);
  });
  it('rejects garbage', () => {
    expect(WebhookUrlSchema.safeParse('not a url').success).toBe(false);
  });
  it('accepts https script.google.com', () => {
    expect(
      WebhookUrlSchema.safeParse(
        'https://script.google.com/macros/s/AKfy/exec',
      ).success,
    ).toBe(true);
  });
});

describe('postSubmission', () => {
  it('rejects non-https URLs without calling fetch', async () => {
    const fetchSpy = vi.fn();
    const r = await postSubmission(
      'http://example.com',
      sample,
      fetchSpy as unknown as typeof fetch,
    );
    expect(r.ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refuses when host permission is missing', async () => {
    (globalThis as any).chrome.permissions.contains = vi.fn(async () => false);
    const fetchSpy = vi.fn();
    const r = await postSubmission(
      'https://script.google.com/macros/s/x/exec',
      sample,
      fetchSpy as unknown as typeof fetch,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/host permission/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('uses POST + text/plain to avoid CORS preflight', async () => {
    const fetchSpy = vi.fn(async () => new Response('', { status: 200 }));
    const r = await postSubmission(
      'https://script.google.com/macros/s/x/exec',
      sample,
      fetchSpy as unknown as typeof fetch,
    );
    expect(r.ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const call = fetchSpy.mock.calls[0] as unknown as [string, RequestInit] | undefined;
    if (!call) throw new Error('expected at least one fetch call');
    const init = call[1];
    expect(init.method).toBe('POST');
    expect(((init.headers ?? {}) as Record<string, string>)['Content-Type']).toMatch(
      /text\/plain/,
    );
    expect(init.body).toContain('Stripe');
  });

  it('retries once on network error and reports failure', async () => {
    const fetchSpy = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const r = await postSubmission(
      'https://script.google.com/macros/s/x/exec',
      sample,
      fetchSpy as unknown as typeof fetch,
    );
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(r.ok).toBe(false);
  });

  it('reports HTTP errors with the status code', async () => {
    const fetchSpy = vi.fn(async () => new Response('boom', { status: 500 }));
    const r = await postSubmission(
      'https://script.google.com/macros/s/x/exec',
      sample,
      fetchSpy as unknown as typeof fetch,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/HTTP 500/);
  });
});

describe('postTestPing', () => {
  it('sends a payload with test:true', async () => {
    const fetchSpy = vi.fn(async () => new Response('', { status: 200 }));
    await postTestPing(
      'https://script.google.com/macros/s/x/exec',
      fetchSpy as unknown as typeof fetch,
    );
    const call = fetchSpy.mock.calls[0] as unknown as [string, RequestInit] | undefined;
    if (!call) throw new Error('expected fetch to have been called');
    const body = call[1].body as string;
    const parsed = JSON.parse(body);
    expect(parsed.test).toBe(true);
    expect(parsed.source).toBe('autofilltool');
  });
});
