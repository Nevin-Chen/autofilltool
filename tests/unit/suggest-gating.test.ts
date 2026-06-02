import { describe, expect, it, beforeEach, vi } from 'vitest';
import { installSuggestButtons, guardedConnect, aiConfigured } from '@/content/suggest';
import type { DetectedField } from '@/adapters/types';
import type { JobContext } from '@/content/job-context';
import { defaultSettings, type Settings } from '@/profile/schema';

const ctx: JobContext = {
  company: 'Acme',
  role: 'Engineer',
  jobUrl: 'https://example.com/job',
  jobDescription: '',
};
const HOST = '[data-autofilltool-suggest-host]';

function withProvider(provider: Settings['ai']['provider']): Settings {
  const s = defaultSettings();
  return { ...s, ai: { ...s.ai, provider } };
}

function textareaField(): DetectedField {
  const ta = document.createElement('textarea');
  ta.name = 'why_us';
  document.body.appendChild(ta);
  return { el: ta, kind: 'openEnded', label: 'Why us', confidence: 0.5 };
}

beforeEach(() => {
  document.documentElement.innerHTML = '<head></head><body></body>';
});

describe('aiConfigured', () => {
  it('is false for provider "none", true otherwise', () => {
    expect(aiConfigured(defaultSettings())).toBe(false);
    expect(aiConfigured(withProvider('openai'))).toBe(true);
  });
});

describe('installSuggestButtons visibility gate (FR-013)', () => {
  it('does NOT inject the button when no provider is configured', () => {
    installSuggestButtons([textareaField()], ctx, { aiConfigured: false });
    expect(document.querySelector(HOST)).toBeNull();
  });

  it('injects the button once a provider is configured', () => {
    installSuggestButtons([textareaField()], ctx, { aiConfigured: true });
    expect(document.querySelector(HOST)).not.toBeNull();
  });
});

describe('guardedConnect privacy guard (FR-016)', () => {
  it('opens NO port and shows the prompt when no provider is configured', async () => {
    const connect = vi.fn();
    const onNoProvider = vi.fn();
    const port = await guardedConnect({
      loadSettings: async () => withProvider('none'),
      connect,
      onNoProvider,
    });
    expect(port).toBeNull();
    expect(connect).not.toHaveBeenCalled(); // provably no port opened
    expect(onNoProvider).toHaveBeenCalledTimes(1); // prompt shown
  });

  it('fails safe (no port) when settings cannot be read', async () => {
    const connect = vi.fn();
    const onNoProvider = vi.fn();
    const port = await guardedConnect({
      loadSettings: async () => {
        throw new Error('storage unavailable');
      },
      connect,
      onNoProvider,
    });
    expect(port).toBeNull();
    expect(connect).not.toHaveBeenCalled();
    expect(onNoProvider).toHaveBeenCalledTimes(1);
  });

  it('connects only when a provider is configured', async () => {
    const fakePort = {} as chrome.runtime.Port;
    const connect = vi.fn(() => fakePort);
    const onNoProvider = vi.fn();
    const port = await guardedConnect({
      loadSettings: async () => withProvider('openai'),
      connect,
      onNoProvider,
    });
    expect(port).toBe(fakePort);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(onNoProvider).not.toHaveBeenCalled();
  });
});
