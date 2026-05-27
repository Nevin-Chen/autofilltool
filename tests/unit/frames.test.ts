import { describe, expect, it } from 'vitest';
import {
  isAtsFrameUrl,
  pickTargetFrames,
  mergeFillResponses,
  type FrameInfo,
} from '@/background/frames';
import type { FillPageResponse } from '@/types/messages';

function frame(frameId: number, url: string): FrameInfo {
  return { frameId, url };
}

describe('isAtsFrameUrl', () => {
  it('matches the canonical ATS hostnames', () => {
    expect(isAtsFrameUrl('https://boards.greenhouse.io/foo/jobs/123')).toBe(true);
    expect(isAtsFrameUrl('https://job-boards.greenhouse.io/foo/jobs/123')).toBe(true);
    expect(isAtsFrameUrl('https://jobs.lever.co/acme/abc')).toBe(true);
    expect(isAtsFrameUrl('https://jobs.ashbyhq.com/acme/job-xyz')).toBe(true);
    expect(isAtsFrameUrl('https://acme.myworkdayjobs.com/Careers')).toBe(true);
  });

  it('matches greenhouse custom subdomains', () => {
    // Custom subdomains: careers.acme.com would NOT match because it's not
    // a greenhouse.io host. But subdomains *of* greenhouse.io should match.
    expect(isAtsFrameUrl('https://internal.greenhouse.io/whatever')).toBe(true);
  });

  it('does not match company career pages', () => {
    expect(isAtsFrameUrl('https://acme.com/careers/jobs/123')).toBe(false);
    expect(isAtsFrameUrl('https://careers.acme.com/job/123')).toBe(false);
    expect(isAtsFrameUrl('https://example.com')).toBe(false);
  });

  it('does not match about:blank / unparseable URLs', () => {
    expect(isAtsFrameUrl('about:blank')).toBe(false);
    expect(isAtsFrameUrl('')).toBe(false);
    expect(isAtsFrameUrl('not a url')).toBe(false);
  });
});

describe('pickTargetFrames', () => {
  it('returns ATS frames only when one is present', () => {
    const frames = [
      frame(0, 'https://acme.com/careers/jobs/123'),
      frame(7, 'https://boards.greenhouse.io/embed/job_app?for=acme'),
      frame(9, 'https://www.googletagmanager.com/gtag/js?id=foo'),
    ];
    const picked = pickTargetFrames(frames);
    expect(picked).toHaveLength(1);
    expect(picked[0]!.frameId).toBe(7);
  });

  it('returns all ATS frames when multiple are present', () => {
    // Unusual but possible: a page with two embedded application forms.
    const frames = [
      frame(0, 'https://acme.com/careers'),
      frame(3, 'https://boards.greenhouse.io/embed/job_app?for=a'),
      frame(5, 'https://jobs.lever.co/acme/abc'),
    ];
    const picked = pickTargetFrames(frames);
    expect(picked.map((f) => f.frameId).sort()).toEqual([3, 5]);
  });

  it('falls back to the top frame when no ATS frames are present', () => {
    const frames = [
      frame(0, 'https://acme.com/some-form'),
      frame(2, 'https://example.com/iframe-junk'),
    ];
    const picked = pickTargetFrames(frames);
    expect(picked).toHaveLength(1);
    expect(picked[0]!.frameId).toBe(0);
  });

  it('returns empty list when there are no frames at all', () => {
    expect(pickTargetFrames([])).toEqual([]);
  });

  it('returns empty list when no top frame exists (defensive)', () => {
    const frames = [frame(2, 'https://example.com/iframe-junk')];
    expect(pickTargetFrames(frames)).toEqual([]);
  });
});

/* ----------------------------------------------------- mergeFillResponses */

function ok(
  adapterId: string,
  filled: number,
  skipped = 0,
  failed = 0,
): FillPageResponse {
  return {
    ok: true,
    value: {
      adapterId,
      filled,
      skipped,
      failed,
      total: filled + skipped + failed,
      actions: [],
    },
  };
}

describe('mergeFillResponses', () => {
  it('returns a synthetic zero response when no responses came in', () => {
    const merged = mergeFillResponses([]);
    expect(merged.ok).toBe(true);
    if (merged.ok) {
      expect(merged.value.filled).toBe(0);
      expect(merged.value.total).toBe(0);
      expect(merged.value.adapterId).toBe('generic');
    }
  });

  it('sums counts across multiple ok responses', () => {
    const merged = mergeFillResponses([
      ok('generic', 0, 0, 0),
      ok('greenhouse', 5, 1, 0),
    ]);
    expect(merged.ok).toBe(true);
    if (merged.ok) {
      expect(merged.value.filled).toBe(5);
      expect(merged.value.skipped).toBe(1);
      expect(merged.value.total).toBe(6);
    }
  });

  it('picks the frame with the most filled fields for adapterId', () => {
    const merged = mergeFillResponses([
      ok('generic', 1),
      ok('greenhouse', 6),
      ok('lever', 3),
    ]);
    if (merged.ok) {
      expect(merged.value.adapterId).toBe('greenhouse');
    }
  });

  it('breaks filled-count ties by preferring non-generic adapters', () => {
    const merged = mergeFillResponses([ok('generic', 3), ok('lever', 3)]);
    if (merged.ok) {
      expect(merged.value.adapterId).toBe('lever');
    }
  });

  it('concatenates actions across frames', () => {
    const a: FillPageResponse = {
      ok: true,
      value: {
        adapterId: 'greenhouse',
        filled: 1,
        skipped: 0,
        failed: 0,
        total: 1,
        actions: [{ label: 'First name', kind: 'firstName', status: 'filled' }],
      },
    };
    const b: FillPageResponse = {
      ok: true,
      value: {
        adapterId: 'generic',
        filled: 0,
        skipped: 1,
        failed: 0,
        total: 1,
        actions: [{ label: 'Newsletter', kind: 'email', status: 'skipped' }],
      },
    };
    const merged = mergeFillResponses([a, b]);
    if (merged.ok) {
      expect(merged.value.actions).toHaveLength(2);
      expect(merged.value.actions[0]!.label).toBe('First name');
      expect(merged.value.actions[1]!.label).toBe('Newsletter');
    }
  });

  it('prefers a meaningful error when every frame failed', () => {
    const merged = mergeFillResponses([
      { ok: false, error: 'Could not establish connection. Receiving end does not exist.' },
      { ok: false, error: 'Something else went wrong.' },
    ]);
    expect(merged.ok).toBe(false);
    if (!merged.ok) {
      expect(merged.error).toBe('Something else went wrong.');
    }
  });

  it('falls back to the first error when all errors look like missing listeners', () => {
    const merged = mergeFillResponses([
      { ok: false, error: 'Could not establish connection. Receiving end does not exist.' },
      { ok: false, error: 'Receiving end does not exist.' },
    ]);
    expect(merged.ok).toBe(false);
    if (!merged.ok) {
      expect(merged.error).toMatch(/Could not establish connection/);
    }
  });

  it('mixed ok + err responses ignore the err side', () => {
    const merged = mergeFillResponses([
      ok('greenhouse', 4),
      { ok: false, error: 'Could not establish connection.' },
    ]);
    expect(merged.ok).toBe(true);
    if (merged.ok) {
      expect(merged.value.filled).toBe(4);
      expect(merged.value.adapterId).toBe('greenhouse');
    }
  });
});
