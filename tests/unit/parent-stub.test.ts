import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  __resetAffordanceForTests,
  __clickRemoteChipForTests,
  __getReviewPaneTextForTests,
  __pressReviewKeyForTests,
} from '@/content/affordance';

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
      'https://nvidia.myworkdayjobs.com',
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

describe('parent-stub — remote review round-trip', () => {
  const origin = 'https://job-boards.greenhouse.io';

  beforeEach(() => {
    document.documentElement.innerHTML = '<head></head><body></body>';
    __resetAffordanceForTests();
  });
  afterEach(() => {
    __resetAffordanceForTests();
  });

  function setupCompletedFill(): { src: Window; postMessage: ReturnType<typeof vi.fn> } {
    const postMessage = vi.fn();
    const src = { postMessage } as unknown as Window;
    dispatchMessage(
      { type: 'autofilltool:iframe-pill-needed', detected: 5 },
      origin,
      src,
    );
    dispatchMessage(
      {
        type: 'autofilltool:fill-complete',
        filled: 3,
        skipped: 2,
        failed: 0,
        suggest: 0,
        adapterId: 'greenhouse',
        adapterName: 'Greenhouse',
        resume: 'attached',
        autoLogging: false,
      },
      origin,
      src,
    );
    return { src, postMessage };
  }

  it('chip click posts review-enter to the iframe with the chosen group', () => {
    const { postMessage } = setupCompletedFill();
    expect(__clickRemoteChipForTests('skipped')).toBe(true);
    expect(postMessage).toHaveBeenCalledWith(
      { type: 'autofilltool:review-enter', group: 'skipped' },
      { targetOrigin: origin },
    );
  });

  it('review-state from iframe updates the rendered pane counter', () => {
    const { src } = setupCompletedFill();
    __clickRemoteChipForTests('skipped');
    dispatchMessage(
      {
        type: 'autofilltool:review-state',
        group: 'skipped',
        index: 0,
        total: 2,
        label: 'Why us?',
      },
      origin,
      src,
    );
    expect(__getReviewPaneTextForTests()).toBe('1 of 2 · Why us?');
  });

  it('arrow key on pane posts review-step with direction', () => {
    const { postMessage, src } = setupCompletedFill();
    __clickRemoteChipForTests('skipped');
    dispatchMessage(
      {
        type: 'autofilltool:review-state',
        group: 'skipped',
        index: 0,
        total: 2,
        label: 'a',
      },
      origin,
      src,
    );
    __pressReviewKeyForTests('ArrowRight');
    expect(postMessage).toHaveBeenCalledWith(
      { type: 'autofilltool:review-step', dir: 1 },
      { targetOrigin: origin },
    );
  });

  it('review-empty from iframe drops the pane back to chips view', () => {
    const { src } = setupCompletedFill();
    __clickRemoteChipForTests('skipped');
    dispatchMessage(
      {
        type: 'autofilltool:review-state',
        group: 'skipped',
        index: 0,
        total: 2,
        label: 'a',
      },
      origin,
      src,
    );
    expect(__getReviewPaneTextForTests()).not.toBeNull();
    dispatchMessage({ type: 'autofilltool:review-empty' }, origin, src);
    expect(__getReviewPaneTextForTests()).toBeNull();
  });

  it('review-state from a non-active source is ignored', () => {
    setupCompletedFill();
    const imposter = { postMessage: vi.fn() } as unknown as Window;
    __clickRemoteChipForTests('skipped');
    dispatchMessage(
      {
        type: 'autofilltool:review-state',
        group: 'skipped',
        index: 0,
        total: 2,
        label: 'spoofed',
      },
      origin,
      imposter,
    );
    expect(__getReviewPaneTextForTests()).toMatch(/Loading…/);
  });
});
