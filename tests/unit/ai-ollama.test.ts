import { describe, expect, it, vi } from 'vitest';
import {
  OLLAMA_DEFAULT_BASE,
  OLLAMA_DEFAULT_MODEL,
  resolveEndpoint,
  resolveOriginForPermission,
  streamOllama,
} from '@/ai/providers/ollama';

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

describe('resolveEndpoint', () => {
  it('falls back to localhost when the override is blank', () => {
    expect(resolveEndpoint('')).toBe(`${OLLAMA_DEFAULT_BASE}/v1/chat/completions`);
    expect(resolveEndpoint('   ')).toBe(`${OLLAMA_DEFAULT_BASE}/v1/chat/completions`);
  });

  it('appends /v1/chat/completions to a bare origin', () => {
    expect(resolveEndpoint('http://192.168.1.10:11434')).toBe(
      'http://192.168.1.10:11434/v1/chat/completions',
    );
  });

  it('strips a trailing slash before appending the chat path', () => {
    expect(resolveEndpoint('http://localhost:11434/')).toBe(
      'http://localhost:11434/v1/chat/completions',
    );
  });

  it('keeps an explicit /chat/completions URL untouched', () => {
    expect(
      resolveEndpoint('http://proxy.lan/api/v1/chat/completions'),
    ).toBe('http://proxy.lan/api/v1/chat/completions');
  });
});

describe('resolveOriginForPermission', () => {
  it('returns the origin with a trailing slash', () => {
    expect(resolveOriginForPermission('http://localhost:11434/v1/chat/completions'))
      .toBe('http://localhost:11434/');
    expect(resolveOriginForPermission('http://192.168.1.10:11434')).toBe(
      'http://192.168.1.10:11434/',
    );
  });

  it('falls back to the default when the input is blank', () => {
    expect(resolveOriginForPermission('')).toBe('http://localhost:11434/');
  });

  it('returns null when the input is unparseable', () => {
    expect(resolveOriginForPermission('not a url')).toBeNull();
  });
});

describe('streamOllama', () => {
  it('yields delta.content from the OpenAI-compatible SSE stream', async () => {
    const fetchImpl = vi.fn(async () =>
      sseResponse([
        `data: ${JSON.stringify({ choices: [{ delta: { content: 'Hi ' } }] })}\n\n`,
        `data: ${JSON.stringify({ choices: [{ delta: { content: 'there.' } }] })}\n\n`,
        'data: [DONE]\n\n',
      ]),
    );
    const out = await collect(
      streamOllama({
        apiKey: '',
        model: OLLAMA_DEFAULT_MODEL,
        system: 'sys',
        user: 'hi',
        maxTokens: 256,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    );
    expect(out.join('')).toBe('Hi there.');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('hits the localhost endpoint by default', async () => {
    const fetchImpl = vi.fn(async () => sseResponse(['data: [DONE]\n\n']));
    await collect(
      streamOllama({
        apiKey: '',
        model: OLLAMA_DEFAULT_MODEL,
        system: 's',
        user: 'u',
        maxTokens: 100,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    );
    const call = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toBe('http://localhost:11434/v1/chat/completions');
  });

  it('uses a configured endpoint and appends /v1/chat/completions', async () => {
    const fetchImpl = vi.fn(async () => sseResponse(['data: [DONE]\n\n']));
    await collect(
      streamOllama({
        apiKey: '',
        model: 'llama3.1:8b',
        system: '',
        user: '',
        maxTokens: 1,
        endpoint: 'http://192.168.1.10:11434',
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    );
    const call = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toBe('http://192.168.1.10:11434/v1/chat/completions');
  });

  it('sends a dummy bearer when no api key is provided', async () => {
    const fetchImpl = vi.fn(async () => sseResponse(['data: [DONE]\n\n']));
    await collect(
      streamOllama({
        apiKey: '',
        model: OLLAMA_DEFAULT_MODEL,
        system: '',
        user: '',
        maxTokens: 1,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    );
    const headers = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1]
      .headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer ollama');
  });

  it('passes a user-provided proxy token through unchanged', async () => {
    const fetchImpl = vi.fn(async () => sseResponse(['data: [DONE]\n\n']));
    await collect(
      streamOllama({
        apiKey: 'proxy-secret',
        model: OLLAMA_DEFAULT_MODEL,
        system: '',
        user: '',
        maxTokens: 1,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    );
    const headers = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1]
      .headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer proxy-secret');
  });

  it('sends the chat-completions body shape with stream:true', async () => {
    const fetchImpl = vi.fn(async () => sseResponse(['data: [DONE]\n\n']));
    await collect(
      streamOllama({
        apiKey: '',
        model: 'llama3.2',
        system: 'sys-prompt',
        user: 'user-prompt',
        maxTokens: 128,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    );
    const call = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(call[1].body as string);
    expect(body.model).toBe('llama3.2');
    expect(body.stream).toBe(true);
    expect(body.messages[0]).toEqual({ role: 'system', content: 'sys-prompt' });
    expect(body.messages[1]).toEqual({ role: 'user', content: 'user-prompt' });
  });

  it('throws on non-OK HTTP (e.g. Ollama not running)', async () => {
    const fetchImpl = vi.fn(
      async () => new Response('connection refused', { status: 503 }),
    );
    await expect(
      collect(
        streamOllama({
          apiKey: '',
          model: OLLAMA_DEFAULT_MODEL,
          system: '',
          user: '',
          maxTokens: 1,
          fetchImpl: fetchImpl as unknown as typeof fetch,
        }),
      ),
    ).rejects.toThrow(/HTTP 503/);
  });
});
