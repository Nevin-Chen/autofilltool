/**
 * Minimal Server-Sent Events parser shared by both providers.
 *
 * Reads a ReadableStream<Uint8Array>, splits it into UTF-8 lines, groups
 * lines into events terminated by a blank line, and yields {event, data}
 * objects. Multi-line `data:` lines are joined with `\n` per the spec.
 *
 * Tiny by design: only the fields we need (event, data). No retry
 * semantics, no `id` reconnection. We're consuming one-shot completions,
 * not a long-lived event source.
 */

export type SSEMessage = {
  event: string;
  data: string;
};

export async function* parseSSE(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<SSEMessage, void, unknown> {
  const decoder = new TextDecoder('utf-8');
  const reader = stream.getReader();
  let buffer = '';
  let eventName = '';
  let dataLines: string[] = [];

  const flush = (): SSEMessage | null => {
    if (dataLines.length === 0 && !eventName) return null;
    const msg: SSEMessage = { event: eventName || 'message', data: dataLines.join('\n') };
    eventName = '';
    dataLines = [];
    return msg;
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Process complete lines. SSE allows \n, \r\n, or \r.
      let idx: number;
      while ((idx = nextLineBreak(buffer)) !== -1) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + (buffer[idx] === '\r' && buffer[idx + 1] === '\n' ? 2 : 1));

        if (line === '') {
          const msg = flush();
          if (msg) yield msg;
          continue;
        }
        if (line.startsWith(':')) continue; // comment
        const colon = line.indexOf(':');
        const field = colon === -1 ? line : line.slice(0, colon);
        let value = colon === -1 ? '' : line.slice(colon + 1);
        if (value.startsWith(' ')) value = value.slice(1);

        if (field === 'event') eventName = value;
        else if (field === 'data') dataLines.push(value);
        // ignore id / retry
      }
    }

    // Final decoder flush + trailing buffer.
    buffer += decoder.decode();
    if (buffer.length > 0) {
      // The remainder is a partial line; only treat as a complete field if
      // it ends naturally. For our providers the stream always ends after a
      // blank line so this rarely matters.
    }
    const last = flush();
    if (last) yield last;
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // already released
    }
  }
}

function nextLineBreak(s: string): number {
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\n' || c === '\r') return i;
  }
  return -1;
}
