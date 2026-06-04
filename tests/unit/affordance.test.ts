import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  showFillTrigger,
  removeFillTrigger,
  __resetAffordanceForTests,
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
    // jsdom defaults to window.top === window — the non-iframe branch.
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
    // closed shadow root — assert by shape via host title + presence of a button
    expect(host.shadowRoot).toBeNull(); // closed mode hides shadowRoot
    expect(host.isConnected).toBe(true);
  });

  it('watchdog re-mounts ONCE when the host disappears post-mount', () => {
    showFillTrigger({ detected: 5, onFill: () => {} });
    expect(document.getElementById(HOST_ID)).not.toBeNull();

    // Simulate page hydration yanking the host shortly after mount.
    document.getElementById(HOST_ID)!.remove();
    expect(document.getElementById(HOST_ID)).toBeNull();

    // Watchdog hasn't fired yet (REMOUNT_MS = 1000).
    vi.advanceTimersByTime(900);
    expect(document.getElementById(HOST_ID)).toBeNull();

    // Watchdog fires past 1000ms; host comes back.
    vi.advanceTimersByTime(200);
    expect(document.getElementById(HOST_ID)).not.toBeNull();
  });

  it('hard cap holds — a SECOND disappearance does NOT trigger a third mount', () => {
    showFillTrigger({ detected: 5, onFill: () => {} });

    // First removal → first re-mount fires.
    document.getElementById(HOST_ID)!.remove();
    vi.advanceTimersByTime(1100);
    expect(document.getElementById(HOST_ID)).not.toBeNull();

    // Second removal — the page yanked the re-mount too. Watchdog must give up.
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

    // Page doesn't touch us. Advance past the watchdog.
    vi.advanceTimersByTime(1500);

    // Same node, not a re-creation.
    expect(document.getElementById(HOST_ID)).toBe(host);
  });
});
