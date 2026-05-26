import { describe, expect, it } from 'vitest';
import { parseSSE } from '@/ai/sse';

/**
 * Build a ReadableStream<Uint8Array> from string chunks so we can exercise
 * the parser with realistic SSE payloads, including splits that fall mid-line.
 */
function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
}

async function collect(s: ReadableStream<Uint8Array>) {
  const out: Array<{ event: string; data: string }> = [];
  for await (const m of parseSSE(s)) out.push(m);
  return out;
}

describe('parseSSE', () => {
  it('parses a sequence of simple data: lines', async () => {
    const events = await collect(
      streamOf(['data: hello\n\n', 'data: world\n\n']),
    );
    expect(events).toEqual([
      { event: 'message', data: 'hello' },
      { event: 'message', data: 'world' },
    ]);
  });

  it('joins multi-line data fields with \\n', async () => {
    const events = await collect(
      streamOf(['data: line1\n', 'data: line2\n', '\n']),
    );
    expect(events).toEqual([{ event: 'message', data: 'line1\nline2' }]);
  });

  it('respects the event: field', async () => {
    const events = await collect(
      streamOf(['event: ping\n', 'data: {"x":1}\n', '\n']),
    );
    expect(events).toEqual([{ event: 'ping', data: '{"x":1}' }]);
  });

  it('ignores comment lines that start with :', async () => {
    const events = await collect(
      streamOf([':keepalive\n', 'data: hi\n\n']),
    );
    expect(events).toEqual([{ event: 'message', data: 'hi' }]);
  });

  it('handles chunks split mid-line', async () => {
    const events = await collect(
      streamOf(['data: par', 'tial\n', '\n', 'data: next\n\n']),
    );
    expect(events).toEqual([
      { event: 'message', data: 'partial' },
      { event: 'message', data: 'next' },
    ]);
  });

  it('strips one leading space after the colon', async () => {
    const events = await collect(streamOf(['data:no-space\n\n', 'data: with-space\n\n']));
    expect(events.map((e) => e.data)).toEqual(['no-space', 'with-space']);
  });
});
