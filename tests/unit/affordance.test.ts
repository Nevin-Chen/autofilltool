import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  showFillTrigger,
  showFillTriggerDone,
  setRemoteReviewState,
  clearRemoteReviewState,
  removeFillTrigger,
  nextConnected,
  __resetAffordanceForTests,
  __getReviewStateForTests,
  __enterReviewForTests,
  __stepReviewForTests,
  __getDoneNoteForTests,
  __clickRemoteChipForTests,
  __getReviewPaneTextForTests,
  __pressReviewKeyForTests,
  type ReviewableField,
  type TriggerStats,
} from '@/content/affordance';

const HOST_ID = 'autofilltool-trigger-host';

describe('affordance — mount + bounded watchdog re-mount', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.documentElement.innerHTML = '<head></head><body></body>';
    __resetAffordanceForTests();
  });
  afterEach(() => {
    __resetAffordanceForTests();
    vi.useRealTimers();
  });

  it('mounts the host as a direct child of <body>', () => {
    showFillTrigger({ detected: 3, onFill: () => {} });
    const host = document.getElementById(HOST_ID);
    expect(host).not.toBeNull();
    expect(host!.parentElement).toBe(document.body);
  });

  it('anchors the host bottom-right on top-level pages (non-iframe default)', () => {
    showFillTrigger({ detected: 3, onFill: () => {} });
    const host = document.getElementById(HOST_ID)!;
    expect(host.style.bottom).toBe('16px');
    expect(host.style.top).toBe('');
    expect(host.style.right).toBe('16px');
  });

  it('renders the idle pill with a clickable Fill tab', () => {
    const onFill = vi.fn();
    showFillTrigger({ detected: 7, onFill });
    const host = document.getElementById(HOST_ID)!;
    expect(host.shadowRoot).toBeNull();
    expect(host.isConnected).toBe(true);
  });

  it('watchdog re-mounts ONCE when the host disappears post-mount', () => {
    showFillTrigger({ detected: 5, onFill: () => {} });
    expect(document.getElementById(HOST_ID)).not.toBeNull();

    document.getElementById(HOST_ID)!.remove();
    expect(document.getElementById(HOST_ID)).toBeNull();

    vi.advanceTimersByTime(900);
    expect(document.getElementById(HOST_ID)).toBeNull();

    vi.advanceTimersByTime(200);
    expect(document.getElementById(HOST_ID)).not.toBeNull();
  });

  it('hard cap holds — a SECOND disappearance does NOT trigger a third mount', () => {
    showFillTrigger({ detected: 5, onFill: () => {} });

    document.getElementById(HOST_ID)!.remove();
    vi.advanceTimersByTime(1100);
    expect(document.getElementById(HOST_ID)).not.toBeNull();

    document.getElementById(HOST_ID)!.remove();
    vi.advanceTimersByTime(1500);
    expect(document.getElementById(HOST_ID)).toBeNull();
  });

  it('watchdog does NOT re-mount after explicit removeFillTrigger', () => {
    showFillTrigger({ detected: 5, onFill: () => {} });
    expect(document.getElementById(HOST_ID)).not.toBeNull();

    removeFillTrigger();
    vi.advanceTimersByTime(1500);
    expect(document.getElementById(HOST_ID)).toBeNull();
  });

  it('watchdog does NOT re-mount when the host is still present (happy path)', () => {
    showFillTrigger({ detected: 5, onFill: () => {} });
    const host = document.getElementById(HOST_ID)!;

    vi.advanceTimersByTime(1500);

    expect(document.getElementById(HOST_ID)).toBe(host);
  });
});

describe('nextConnected — review iteration', () => {
  function mk(connected: boolean[]): ReviewableField[] {
    return connected.map((c, i) => {
      const el = document.createElement('input');
      if (c) document.body.appendChild(el);
      return { group: 'skipped', label: `f${i}`, el };
    });
  }
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('returns -1 for an empty list', () => {
    expect(nextConnected([], -1, 1)).toBe(-1);
  });

  it('advances forward and wraps at the end', () => {
    const items = mk([true, true, true]);
    expect(nextConnected(items, 0, 1)).toBe(1);
    expect(nextConnected(items, 2, 1)).toBe(0);
  });

  it('steps backward and wraps at the start', () => {
    const items = mk([true, true, true]);
    expect(nextConnected(items, 0, -1)).toBe(2);
    expect(nextConnected(items, 1, -1)).toBe(0);
  });

  it('skips disconnected items', () => {
    const items = mk([true, false, true]);
    expect(nextConnected(items, 0, 1)).toBe(2);
    expect(nextConnected(items, 2, 1)).toBe(0);
  });

  it('returns -1 when no item is connected', () => {
    const items = mk([false, false]);
    expect(nextConnected(items, -1, 1)).toBe(-1);
  });

  it('initial entry (from = -1) lands on the first connected item', () => {
    const items = mk([false, true, true]);
    expect(nextConnected(items, -1, 1)).toBe(1);
  });
});

describe('chip-as-button review mode', () => {
  const baseStats: TriggerStats = {
    filled: 1,
    skipped: 2,
    failed: 0,
    suggest: 0,
    adapterId: 'generic',
    adapterName: 'generic',
    resume: 'noResume',
    autoLogging: false,
  };

  beforeEach(() => {
    document.documentElement.innerHTML = '<head></head><body></body>';
    __resetAffordanceForTests();
  });
  afterEach(() => {
    __resetAffordanceForTests();
  });

  function mkItem(group: ReviewableField['group'], label: string): ReviewableField {
    const el = document.createElement('input');
    el.setAttribute('aria-label', label);
    document.body.appendChild(el);
    return { group, label, el };
  }

  it('enters review mode and lands on the first connected item', () => {
    const items = [
      mkItem('skipped', 'why us?'),
      mkItem('skipped', 'sponsorship'),
    ];
    showFillTriggerDone(baseStats, items);
    expect(__getReviewStateForTests()).toBeNull();
    __enterReviewForTests('skipped');
    expect(__getReviewStateForTests()).toEqual({ group: 'skipped', index: 0 });
  });

  it('arrow-step advances and wraps', () => {
    const items = [mkItem('skipped', 'a'), mkItem('skipped', 'b')];
    showFillTriggerDone(baseStats, items);
    __enterReviewForTests('skipped');
    __stepReviewForTests(1);
    expect(__getReviewStateForTests()).toEqual({ group: 'skipped', index: 1 });
    __stepReviewForTests(1);
    expect(__getReviewStateForTests()).toEqual({ group: 'skipped', index: 0 });
  });

  it('skips fields that were detached between fill and review', () => {
    const items = [mkItem('skipped', 'a'), mkItem('skipped', 'b'), mkItem('skipped', 'c')];
    showFillTriggerDone(baseStats, items);
    items[1]!.el.remove();
    __enterReviewForTests('skipped');
    expect(__getReviewStateForTests()).toEqual({ group: 'skipped', index: 0 });
    __stepReviewForTests(1);
    expect(__getReviewStateForTests()).toEqual({ group: 'skipped', index: 2 });
  });

  it('does NOT enter review when every item in the group is gone', () => {
    const items = [mkItem('suggest', 'cover letter')];
    showFillTriggerDone(baseStats, items);
    items[0]!.el.remove();
    __enterReviewForTests('suggest');
    expect(__getReviewStateForTests()).toBeNull();
  });
});

describe('post-fill note — Sheets link state', () => {
  beforeEach(() => {
    document.documentElement.innerHTML = '<head></head><body></body>';
    __resetAffordanceForTests();
  });
  afterEach(() => {
    __resetAffordanceForTests();
  });

  const stats = (autoLogging: boolean): TriggerStats => ({
    filled: 1,
    skipped: 0,
    failed: 0,
    suggest: 0,
    adapterId: 'generic',
    adapterName: 'generic',
    resume: 'noResume',
    autoLogging,
  });

  it('shows the auto-log confirmation when Sheets is connected', () => {
    showFillTriggerDone(stats(true), []);
    const note = __getDoneNoteForTests();
    expect(note?.text).toMatch(/auto-logging/i);
    expect(note?.text).toMatch(/google sheets/i);
    expect(note?.href).toBeNull();
  });

  it('shows the connect-Sheet prompt with a README link when not connected', () => {
    showFillTriggerDone(stats(false), []);
    const note = __getDoneNoteForTests();
    expect(note?.text).toMatch(/connect a google sheet/i);
    expect(note?.href).toBe(
      'https://github.com/Nevin-Chen/autofilltool#google-sheets-logging',
    );
  });
});

describe('remote review (iframe-driven)', () => {
  beforeEach(() => {
    document.documentElement.innerHTML = '<head></head><body></body>';
    __resetAffordanceForTests();
  });
  afterEach(() => {
    __resetAffordanceForTests();
  });

  const stats: TriggerStats = {
    filled: 3,
    skipped: 2,
    failed: 0,
    suggest: 0,
    adapterId: 'generic',
    adapterName: 'generic',
    resume: 'noResume',
    autoLogging: false,
  };

  it('chips are clickable based on counts in remote mode (no local items needed)', () => {
    const remote = { onEnter: vi.fn(), onStep: vi.fn(), onExit: vi.fn() };
    showFillTriggerDone(stats, [], { remote });
    expect(__clickRemoteChipForTests('filled')).toBe(true);
    expect(remote.onEnter).toHaveBeenCalledWith('filled');
  });

  it('chip with zero count is NOT clickable', () => {
    const remote = { onEnter: vi.fn(), onStep: vi.fn(), onExit: vi.fn() };
    showFillTriggerDone(stats, [], { remote });
    expect(__clickRemoteChipForTests('suggest')).toBe(false);
    expect(remote.onEnter).not.toHaveBeenCalled();
  });

  it('shows a "Loading…" placeholder until the iframe reports state', () => {
    const remote = { onEnter: vi.fn(), onStep: vi.fn(), onExit: vi.fn() };
    showFillTriggerDone(stats, [], { remote });
    __clickRemoteChipForTests('skipped');
    expect(__getReviewPaneTextForTests()).toMatch(/Loading…/);
  });

  it('setRemoteReviewState updates the rendered counter + label', () => {
    const remote = { onEnter: vi.fn(), onStep: vi.fn(), onExit: vi.fn() };
    showFillTriggerDone(stats, [], { remote });
    __clickRemoteChipForTests('skipped');
    setRemoteReviewState({ group: 'skipped', index: 0, total: 2, label: 'Why us?' });
    expect(__getReviewPaneTextForTests()).toBe('1 of 2 · Why us?');
    setRemoteReviewState({ group: 'skipped', index: 1, total: 2, label: 'Sponsorship?' });
    expect(__getReviewPaneTextForTests()).toBe('2 of 2 · Sponsorship?');
  });

  it('arrow key on the pane fires onStep in remote mode', () => {
    const remote = { onEnter: vi.fn(), onStep: vi.fn(), onExit: vi.fn() };
    showFillTriggerDone(stats, [], { remote });
    __clickRemoteChipForTests('skipped');
    setRemoteReviewState({ group: 'skipped', index: 0, total: 2, label: 'a' });
    __pressReviewKeyForTests('ArrowRight');
    expect(remote.onStep).toHaveBeenCalledWith(1);
    __pressReviewKeyForTests('ArrowLeft');
    expect(remote.onStep).toHaveBeenCalledWith(-1);
  });

  it('Escape fires onExit AND closes the pane locally', () => {
    const remote = { onEnter: vi.fn(), onStep: vi.fn(), onExit: vi.fn() };
    showFillTriggerDone(stats, [], { remote });
    __clickRemoteChipForTests('skipped');
    setRemoteReviewState({ group: 'skipped', index: 0, total: 2, label: 'a' });
    __pressReviewKeyForTests('Escape');
    expect(remote.onExit).toHaveBeenCalled();
    expect(__getReviewPaneTextForTests()).toBeNull(); // back to chips view
  });

  it('clearRemoteReviewState drops back to chips (iframe signals empty group)', () => {
    const remote = { onEnter: vi.fn(), onStep: vi.fn(), onExit: vi.fn() };
    showFillTriggerDone(stats, [], { remote });
    __clickRemoteChipForTests('skipped');
    setRemoteReviewState({ group: 'skipped', index: 0, total: 2, label: 'a' });
    clearRemoteReviewState();
    expect(__getReviewPaneTextForTests()).toBeNull();
  });
});
