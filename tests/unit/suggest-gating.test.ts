import { describe, expect, it, beforeEach, vi } from 'vitest';
import { installSuggestButtons, guardedConnect, aiConfigured, seedForMode} from '@/content/suggest';
import type { DetectedField } from '@/adapters/types';
import type { JobContext } from '@/content/job-context';
import { defaultSettings, type Settings } from '@/profile/schema';

const ctx: JobContext = {
  company: 'Stripe',
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

describe('seedForMode (re-suggest behavior)', () => {
  it('replace clears the box, with or without existing text', () => {
    expect(seedForMode('an existing draft', 'replace')).toBe('');
    expect(seedForMode('', 'replace')).toBe('');
  });

  it('append keeps the text and separates the new draft with a blank line', () => {
    expect(seedForMode('my answer', 'append')).toBe('my answer\n\n');
  });

  it('append trims trailing whitespace before the blank line', () => {
    expect(seedForMode('my answer\n   ', 'append')).toBe('my answer\n\n');
  });

  it('append on an empty (or whitespace-only) box adds no leading blank lines', () => {
    expect(seedForMode('', 'append')).toBe('');
    expect(seedForMode('   \n  ', 'append')).toBe('');
  });
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
    expect(connect).not.toHaveBeenCalled();
    expect(onNoProvider).toHaveBeenCalledTimes(1);
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

  it('reports the resolved settings via onReady before connecting', async () => {
    const fakePort = {} as chrome.runtime.Port;
    const connect = vi.fn(() => fakePort);
    const onReady = vi.fn();
    await guardedConnect({
      loadSettings: async () => withProvider('ollama'),
      connect,
      onNoProvider: vi.fn(),
      onReady,
    });
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(onReady.mock.calls[0]?.[0].ai.provider).toBe('ollama');
    expect(connect).toHaveBeenCalledTimes(1);
    expect(onReady.mock.invocationCallOrder[0]).toBeLessThan(
      connect.mock.invocationCallOrder[0]!,
    );
  });

  it('does not call onReady when no provider is configured', async () => {
    const onReady = vi.fn();
    await guardedConnect({
      loadSettings: async () => withProvider('none'),
      connect: vi.fn(),
      onNoProvider: vi.fn(),
      onReady,
    });
    expect(onReady).not.toHaveBeenCalled();
  });
});
