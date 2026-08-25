import { describe, expect, it, vi } from 'vitest';
import {
  CLAUDE_BRIDGE_DEFAULT_BASE,
  CLAUDE_BRIDGE_DEFAULT_MODEL,
  resolveEndpoint,
  resolveOriginForPermission,
  streamClaudeBridge,
} from '@/ai/providers/claude-bridge';
import { providerNeedsKey } from '@/profile/schema';

function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

async function collect(gen: AsyncGenerator<string, void, unknown>) {
  const parts: string[] = [];
  for await (const t of gen) parts.push(t);
  return parts;
}

describe('claude-bridge defaults', () => {
  it('defaults to port 11435, not Ollama 11434', () => {
    expect(CLAUDE_BRIDGE_DEFAULT_BASE).toBe('http://localhost:11435');
    expect(CLAUDE_BRIDGE_DEFAULT_BASE).not.toContain('11434');
  });

  it('defaults to opus', () => {
    expect(CLAUDE_BRIDGE_DEFAULT_MODEL).toBe('opus');
  });
});

describe('resolveEndpoint', () => {
  it('falls back to the bridge port when the override is blank', () => {
    expect(resolveEndpoint('')).toBe(`${CLAUDE_BRIDGE_DEFAULT_BASE}/v1/chat/completions`);
    expect(resolveEndpoint('   ')).toBe(`${CLAUDE_BRIDGE_DEFAULT_BASE}/v1/chat/completions`);
  });

  it('appends /v1/chat/completions to a bare origin', () => {
    expect(resolveEndpoint('http://localhost:11435')).toBe(
      'http://localhost:11435/v1/chat/completions',
    );
  });

  it('strips a trailing slash before appending the chat path', () => {
    expect(resolveEndpoint('http://localhost:11435/')).toBe(
      'http://localhost:11435/v1/chat/completions',
    );
  });

  it('keeps an explicit /chat/completions URL untouched', () => {
    expect(resolveEndpoint('http://localhost:9999/v1/chat/completions')).toBe(
      'http://localhost:9999/v1/chat/completions',
    );
  });
});

describe('resolveOriginForPermission', () => {
  it('returns the origin with a trailing slash', () => {
    expect(resolveOriginForPermission('http://localhost:11435/v1/chat/completions')).toBe(
      'http://localhost:11435/',
    );
  });

  it('falls back to the bridge default when blank', () => {
    expect(resolveOriginForPermission('')).toBe('http://localhost:11435/');
  });

  it('returns null when the input is unparseable', () => {
    expect(resolveOriginForPermission('not a url')).toBeNull();
  });
});

describe('providerNeedsKey', () => {
  it('treats both local providers as keyless', () => {
    expect(providerNeedsKey('claude-bridge')).toBe(false);
    expect(providerNeedsKey('ollama')).toBe(false);
  });

  it('still requires a key for the remote providers', () => {
    expect(providerNeedsKey('openai')).toBe(true);
    expect(providerNeedsKey('anthropic')).toBe(true);
    expect(providerNeedsKey('gemini')).toBe(true);
  });

  it('does not ask for a key when no provider is configured', () => {
    expect(providerNeedsKey('none')).toBe(false);
  });
});

describe('streamClaudeBridge', () => {
  it('yields delta.content from the bridge SSE stream', async () => {
    const fetchImpl = vi.fn(async () =>
      sseResponse([
        `data: ${JSON.stringify({ choices: [{ delta: { content: 'I built ' } }] })}\n\n`,
        `data: ${JSON.stringify({ choices: [{ delta: { content: 'autofilltool.' } }] })}\n\n`,
        'data: [DONE]\n\n',
      ]),
    );
    const out = await collect(
      streamClaudeBridge({
        apiKey: '',
        model: CLAUDE_BRIDGE_DEFAULT_MODEL,
        system: 'sys',
        user: 'why this role?',
        maxTokens: 512,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    );
    expect(out.join('')).toBe('I built autofilltool.');
  });

  it('hits the bridge port by default', async () => {
    const fetchImpl = vi.fn(async () => sseResponse(['data: [DONE]\n\n']));
    await collect(
      streamClaudeBridge({
        apiKey: '',
        model: CLAUDE_BRIDGE_DEFAULT_MODEL,
        system: 's',
        user: 'u',
        maxTokens: 100,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    );
    const call = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toBe('http://localhost:11435/v1/chat/completions');
  });

  it('sends a placeholder bearer since the subscription lives in the CLI', async () => {
    const fetchImpl = vi.fn(async () => sseResponse(['data: [DONE]\n\n']));
    await collect(
      streamClaudeBridge({
        apiKey: '',
        model: CLAUDE_BRIDGE_DEFAULT_MODEL,
        system: '',
        user: '',
        maxTokens: 1,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    );
    const headers = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1]
      .headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer claude-bridge');
  });

  it('sends the chat-completions body shape with stream:true', async () => {
    const fetchImpl = vi.fn(async () => sseResponse(['data: [DONE]\n\n']));
    await collect(
      streamClaudeBridge({
        apiKey: '',
        model: 'sonnet',
        system: 'sys-prompt',
        user: 'user-prompt',
        maxTokens: 128,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    );
    const call = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(call[1].body as string);
    expect(body.model).toBe('sonnet');
    expect(body.stream).toBe(true);
    expect(body.messages[0]).toEqual({ role: 'system', content: 'sys-prompt' });
    expect(body.messages[1]).toEqual({ role: 'user', content: 'user-prompt' });
  });

  it('throws on non-OK HTTP (bridge not started)', async () => {
    const fetchImpl = vi.fn(
      async () => new Response('connection refused', { status: 503 }),
    );
    await expect(
      collect(
        streamClaudeBridge({
          apiKey: '',
          model: CLAUDE_BRIDGE_DEFAULT_MODEL,
          system: '',
          user: '',
          maxTokens: 1,
          fetchImpl: fetchImpl as unknown as typeof fetch,
        }),
      ),
    ).rejects.toThrow(/HTTP 503/);
  });
});
