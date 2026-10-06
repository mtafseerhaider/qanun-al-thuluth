export interface SseMessage {
  event: string | undefined;
  data: string;
}

/** Parses a Server-Sent Events byte stream into messages (Web Streams only, no Node APIs). */
export async function* parseSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseMessage> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const message = toMessage(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
        if (message) yield message;
        boundary = buffer.indexOf('\n\n');
      }
    }
    const tail = toMessage(buffer);
    if (tail) yield tail;
  } finally {
    reader.releaseLock();
  }
}

function toMessage(block: string): SseMessage | null {
  let event: string | undefined;
  const data: string[] = [];
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
  }
  return data.length > 0 ? { event, data: data.join('\n') } : null;
}

/** Encodes one SSE message for a streaming Edge Function response. */
export function encodeSse(event: string, data: unknown): Uint8Array {
  return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}
