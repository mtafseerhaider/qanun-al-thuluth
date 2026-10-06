/**
 * Minimal Server-Sent Events parser (WHATWG "event stream interpretation") for `ai-chat`
 * (06 §4.1: `id: {seq}\nevent: {type}\ndata: {json}\n\n`, `: ping` comments every 15 s). It is fed
 * decoded text chunks of any size, so an event split across network chunks (or a CRLF split
 * between two chunks) is reassembled. Pure and synchronous: unit-tested without a network.
 */

export interface SseMessage {
  /** `event:` field; `message` when absent (per spec). */
  event: string;
  /** `data:` lines joined with `\n`. */
  data: string;
  /** Last `id:` seen (sticky across events, per spec). */
  id: string | null;
}

export interface SseParser {
  /** Feeds a decoded chunk; complete events are emitted synchronously. */
  push(chunk: string): void;
  /** Flushes a trailing event that was not followed by a blank line (stream closed). */
  end(): void;
}

export function createSseParser(onMessage: (m: SseMessage) => void): SseParser {
  let buffer = '';
  let pendingCr = false;
  let event = '';
  let data: string[] = [];
  let hasData = false;
  let lastId: string | null = null;

  const dispatch = () => {
    if (hasData) onMessage({ event: event || 'message', data: data.join('\n'), id: lastId });
    event = '';
    data = [];
    hasData = false;
  };

  const line = (raw: string) => {
    if (raw === '') {
      dispatch();
      return;
    }
    if (raw.startsWith(':')) return; // comment, e.g. ": ping"
    const colon = raw.indexOf(':');
    const field = colon === -1 ? raw : raw.slice(0, colon);
    let value = colon === -1 ? '' : raw.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    switch (field) {
      case 'event':
        event = value;
        break;
      case 'data':
        data.push(value);
        hasData = true;
        break;
      case 'id':
        if (!value.includes('\0')) lastId = value;
        break;
      default:
        // `retry` and unknown fields are ignored: the client never reconnects a chat turn.
        break;
    }
  };

  return {
    push(chunk: string) {
      let text = chunk;
      // A CR at the end of the previous chunk already ended a line; drop the LF that follows it.
      if (pendingCr && text.startsWith('\n')) text = text.slice(1);
      pendingCr = false;
      buffer += text;
      let start = 0;
      for (let i = 0; i < buffer.length; i += 1) {
        const c = buffer[i];
        if (c !== '\n' && c !== '\r') continue;
        line(buffer.slice(start, i));
        if (c === '\r') {
          if (i + 1 < buffer.length) {
            if (buffer[i + 1] === '\n') i += 1;
          } else pendingCr = true;
        }
        start = i + 1;
      }
      buffer = buffer.slice(start);
    },
    end() {
      if (buffer.length > 0) line(buffer);
      buffer = '';
      dispatch();
    },
  };
}

/** Minimal reader shape shared by WHATWG and `expo/fetch` streams. */
export interface ByteStreamReader {
  read(): Promise<{ done: boolean; value?: Uint8Array | undefined }>;
  cancel?(reason?: unknown): Promise<void>;
  releaseLock?(): void;
}

/** Decodes UTF-8 bytes (multi-byte characters may straddle chunks) and feeds the parser. */
export async function readSseStream(
  reader: ByteStreamReader,
  onMessage: (m: SseMessage) => void,
  decoder: { decode(input?: Uint8Array, opts?: { stream?: boolean }): string } = new TextDecoder(),
): Promise<void> {
  const parser = createSseParser(onMessage);
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value && value.length > 0) parser.push(decoder.decode(value, { stream: true }));
  }
  const tail = decoder.decode();
  if (tail) parser.push(tail);
  parser.end();
}
