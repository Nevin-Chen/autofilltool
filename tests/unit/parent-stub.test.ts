import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { __resetAffordanceForTests } from '@/content/affordance';

// Auto-installs the parent-stub message listener once at test-file load.
import '@/content/parent-stub';

const HOST_ID = 'autofilltool-trigger-host';

function dispatchMessage(data: unknown, origin: string, source?: Window): void {
  const ev = new MessageEvent('message', { data, origin, source: source ?? null });
  window.dispatchEvent(ev);
}

describe('parent-stub — postMessage protocol', () => {
  beforeEach(() => {
    document.documentElement.innerHTML = '<head></head><body></body>';
    __resetAffordanceForTests();
  });

  afterEach(() => {
    __resetAffordanceForTests();
  });

  it('mounts the pill on a valid iframe-pill-needed from an ATS origin', () => {
    expect(document.getElementById(HOST_ID)).toBeNull();
    dispatchMessage(
      { type: 'autofilltool:iframe-pill-needed', detected: 7 },
      'https://job-boards.greenhouse.io',
    );
    expect(document.getElementById(HOST_ID)).not.toBeNull();
  });

  it('accepts messages from each curated ATS host family', () => {
    const hosts = [
      'https://boards.greenhouse.io',
      'https://jobs.lever.co',
      'https://jobs.ashbyhq.com',
      'https://acme.myworkdayjobs.com',
    ];
    for (const origin of hosts) {
      __resetAffordanceForTests();
      dispatchMessage(
        { type: 'autofilltool:iframe-pill-needed', detected: 3 },
        origin,
      );
      expect(document.getElementById(HOST_ID)).not.toBeNull();
    }
  });

  it('rejects messages from non-ATS origins', () => {
    dispatchMessage(
      { type: 'autofilltool:iframe-pill-needed', detected: 7 },
      'https://evil.example.com',
    );
    expect(document.getElementById(HOST_ID)).toBeNull();
  });

  it('rejects malformed payloads (wrong type, missing detected, wrong type)', () => {
    dispatchMessage('not an object', 'https://job-boards.greenhouse.io');
    dispatchMessage(
      { type: 'autofilltool:something-else', detected: 7 },
      'https://job-boards.greenhouse.io',
    );
    dispatchMessage(
      { type: 'autofilltool:iframe-pill-needed' /* no detected */ },
      'https://job-boards.greenhouse.io',
    );
    dispatchMessage(
      { type: 'autofilltool:iframe-pill-needed', detected: 'seven' },
      'https://job-boards.greenhouse.io',
    );

    expect(document.getElementById(HOST_ID)).toBeNull();
  });

  it('sends ack back to the source iframe so its retries stop', () => {
    const sourceWindow = { postMessage: vi.fn() } as unknown as Window;
    dispatchMessage(
      { type: 'autofilltool:iframe-pill-needed', detected: 3 },
      'https://job-boards.greenhouse.io',
      sourceWindow,
    );

    expect(sourceWindow.postMessage).toHaveBeenCalledWith(
      { type: 'autofilltool:ack' },
      { targetOrigin: 'https://job-boards.greenhouse.io' },
    );
  });

  it('renders results state on fill-complete from the active source', () => {
    const src = { postMessage: vi.fn() } as unknown as Window;
    dispatchMessage(
      { type: 'autofilltool:iframe-pill-needed', detected: 4 },
      'https://job-boards.greenhouse.io',
      src,
    );
    expect(document.getElementById(HOST_ID)).not.toBeNull();

    expect(() =>
      dispatchMessage(
        {
          type: 'autofilltool:fill-complete',
          filled: 4,
          skipped: 0,
          failed: 0,
          suggest: 1,
          adapterId: 'greenhouse',
          adapterName: 'Greenhouse',
          resume: 'attached',
        },
        'https://job-boards.greenhouse.io',
        src,
      ),
    ).not.toThrow();
    expect(document.getElementById(HOST_ID)).not.toBeNull();
  });

  it('rejects fill-complete from a source that did not announce itself', () => {
    const announcer = { postMessage: vi.fn() } as unknown as Window;
    const imposter = { postMessage: vi.fn() } as unknown as Window;

    dispatchMessage(
      { type: 'autofilltool:iframe-pill-needed', detected: 4 },
      'https://job-boards.greenhouse.io',
      announcer,
    );

    // Imposter tries to drive the pill state — should be ignored.
    expect(() =>
      dispatchMessage(
        {
          type: 'autofilltool:fill-complete',
          filled: 999,
          skipped: 0,
          failed: 0,
          suggest: 0,
          adapterId: 'greenhouse',
          adapterName: 'Greenhouse',
          resume: 'noResume',
        },
        'https://job-boards.greenhouse.io',
        imposter,
      ),
    ).not.toThrow();
  });

  it('rejects fill-complete with an unknown adapterId without throwing', () => {
    const src = { postMessage: vi.fn() } as unknown as Window;
    dispatchMessage(
      { type: 'autofilltool:iframe-pill-needed', detected: 1 },
      'https://job-boards.greenhouse.io',
      src,
    );
    expect(() =>
      dispatchMessage(
        {
          type: 'autofilltool:fill-complete',
          filled: 1,
          skipped: 0,
          failed: 0,
          suggest: 0,
          adapterId: 'totally-not-real',
          adapterName: 'nope',
          resume: 'noResume',
        },
        'https://job-boards.greenhouse.io',
        src,
      ),
    ).not.toThrow();
  });
});
