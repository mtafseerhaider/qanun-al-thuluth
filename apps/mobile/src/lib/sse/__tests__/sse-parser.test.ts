import { createSseParser, readSseStream, type SseMessage } from '../sse-parser';

function collect() {
  const out: SseMessage[] = [];
  return { out, parser: createSseParser((m) => out.push(m)) };
}

describe('createSseParser', () => {
  it('parses id, event and data fields', () => {
    const { out, parser } = collect();
    parser.push('id: 1\nevent: message.delta\ndata: {"text":"Hi"}\n\n');
    expect(out).toEqual([{ id: '1', event: 'message.delta', data: '{"text":"Hi"}' }]);
  });

  it('reassembles an event split across chunks, including inside a field', () => {
    const { out, parser } = collect();
    parser.push('id: 7\nev');
    parser.push('ent: done\nda');
    parser.push('ta: {"a"');
    expect(out).toHaveLength(0);
    parser.push(':1}\n');
    parser.push('\n');
    expect(out).toEqual([{ id: '7', event: 'done', data: '{"a":1}' }]);
  });

  it('handles CRLF and CR line endings, also when CRLF is split between chunks', () => {
    const { out, parser } = collect();
    parser.push('event: a\r\ndata: 1\r');
    parser.push('\n\r\nevent: b\rdata: 2\r\r');
    expect(out.map((m) => [m.event, m.data])).toEqual([
      ['a', '1'],
      ['b', '2'],
    ]);
  });

  it('ignores comments such as keep-alive pings', () => {
    const { out, parser } = collect();
    parser.push(': ping\n\n: ping\n\ndata: x\n\n');
    expect(out).toEqual([{ id: null, event: 'message', data: 'x' }]);
  });

  it('joins multi-line data with newlines and keeps the last id (sticky)', () => {
    const { out, parser } = collect();
    parser.push('id: 3\ndata: one\ndata: two\n\nevent: e\ndata: three\n\n');
    expect(out).toEqual([
      { id: '3', event: 'message', data: 'one\ntwo' },
      { id: '3', event: 'e', data: 'three' },
    ]);
  });

  it('dispatches nothing for an event without data and resets the event name', () => {
    const { out, parser } = collect();
    parser.push('event: lonely\n\ndata: y\n\n');
    expect(out).toEqual([{ id: null, event: 'message', data: 'y' }]);
  });

  it('flushes a trailing event on end()', () => {
    const { out, parser } = collect();
    parser.push('event: done\ndata: {}');
    expect(out).toHaveLength(0);
    parser.end();
    expect(out).toEqual([{ id: null, event: 'done', data: '{}' }]);
  });

  it('strips only one leading space from values', () => {
    const { out, parser } = collect();
    parser.push('data:  two spaces\ndata:none\n\n');
    expect(out[0]?.data).toBe(' two spaces\nnone');
  });
});

describe('readSseStream', () => {
  it('decodes UTF-8 split across byte chunks (Urdu text)', async () => {
    const bytes = new TextEncoder().encode('event: message.delta\ndata: {"text":"سلام"}\n\n');
    const chunks = [bytes.slice(0, 33), bytes.slice(33, 36), bytes.slice(36)];
    let i = 0;
    const reader = {
      read: async () =>
        i < chunks.length ? { done: false, value: chunks[i++] } : { done: true, value: undefined },
    };
    const out: SseMessage[] = [];
    await readSseStream(reader, (m) => out.push(m));
    expect(out).toHaveLength(1);
    expect(JSON.parse(out[0]?.data ?? '{}')).toEqual({ text: 'سلام' });
  });
});
