import { describe, expect, it, vi } from 'vitest';
import { streamOpenAI } from '@/ai/providers/openai';
import { streamAnthropic } from '@/ai/providers/anthropic';

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

describe('streamOpenAI', () => {
  it('yields delta.content from chat-completions chunks', async () => {
    const fetchImpl = vi.fn(async () =>
      sseResponse([
        `data: ${JSON.stringify({ choices: [{ delta: { content: 'Hello, ' } }] })}\n\n`,
        `data: ${JSON.stringify({ choices: [{ delta: { content: 'world' } }] })}\n\n`,
        'data: [DONE]\n\n',
      ]),
    );
    const out = await collect(
      streamOpenAI({
        apiKey: 'sk-test',
        model: 'gpt-4o-mini',
        system: 'sys',
        user: 'hi',
        maxTokens: 256,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    );
    expect(out.join('')).toBe('Hello, world');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('sends bearer auth + stream:true in the request body', async () => {
    const fetchImpl = vi.fn(async () => sseResponse(['data: [DONE]\n\n']));
    await collect(
      streamOpenAI({
        apiKey: 'sk-test',
        model: 'gpt-4o-mini',
        system: 's',
        user: 'u',
        maxTokens: 100,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    );
    const call = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toMatch(/openai\.com/);
    const headers = call[1].headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer sk-test');
    const body = JSON.parse(call[1].body as string);
    expect(body.stream).toBe(true);
    expect(body.model).toBe('gpt-4o-mini');
    expect(body.messages[0]).toEqual({ role: 'system', content: 's' });
  });

  it('throws on non-OK HTTP', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 401 }));
    await expect(
      collect(
        streamOpenAI({
          apiKey: 'bad',
          model: 'gpt-4o-mini',
          system: '',
          user: '',
          maxTokens: 1,
          fetchImpl: fetchImpl as unknown as typeof fetch,
        }),
      ),
    ).rejects.toThrow(/HTTP 401/);
  });
});

describe('streamAnthropic', () => {
  it('yields content_block_delta text', async () => {
    const fetchImpl = vi.fn(async () =>
      sseResponse([
        `event: message_start\ndata: ${JSON.stringify({ type: 'message_start' })}\n\n`,
        `event: content_block_delta\ndata: ${JSON.stringify({
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'Hi ' },
        })}\n\n`,
        `event: content_block_delta\ndata: ${JSON.stringify({
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'there.' },
        })}\n\n`,
        `event: message_stop\ndata: ${JSON.stringify({ type: 'message_stop' })}\n\n`,
      ]),
    );
    const out = await collect(
      streamAnthropic({
        apiKey: 'sk-ant',
        model: 'claude-3-5-haiku-20241022',
        system: 'sys',
        user: 'hi',
        maxTokens: 200,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    );
    expect(out.join('')).toBe('Hi there.');
  });

  it('sends x-api-key + anthropic-version headers', async () => {
    const fetchImpl = vi.fn(async () =>
      sseResponse([
        `event: message_stop\ndata: ${JSON.stringify({ type: 'message_stop' })}\n\n`,
      ]),
    );
    await collect(
      streamAnthropic({
        apiKey: 'sk-ant-test',
        model: 'claude-3-5-haiku-20241022',
        system: '',
        user: '',
        maxTokens: 1,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    );
    const headers = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1]
      .headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('sk-ant-test');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    expect(headers['anthropic-dangerous-direct-browser-access']).toBe('true');
  });

  it('ignores non-text_delta events', async () => {
    const fetchImpl = vi.fn(async () =>
      sseResponse([
        `event: content_block_delta\ndata: ${JSON.stringify({
          type: 'content_block_delta',
          delta: { type: 'input_json_delta', partial_json: '{}' },
        })}\n\n`,
        `event: message_stop\ndata: ${JSON.stringify({ type: 'message_stop' })}\n\n`,
      ]),
    );
    const out = await collect(
      streamAnthropic({
        apiKey: 'k',
        model: 'm',
        system: '',
        user: '',
        maxTokens: 1,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    );
    expect(out).toEqual([]);
  });
});
