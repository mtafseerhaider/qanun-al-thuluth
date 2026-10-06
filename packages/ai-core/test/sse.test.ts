import { describe, expect, it } from 'vitest';

import { encodeSse, parseSse } from '../src/runtime/sse.ts';
import { renderPrompt } from '../src/prompts/render.ts';

describe('sse', () => {
  it('round-trips messages split across chunks', async () => {
    const bytes = new Uint8Array([
      ...encodeSse('delta', { text: 'a' }),
      ...encodeSse('end', { ok: true }),
    ]);
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(bytes.slice(0, 7));
        c.enqueue(bytes.slice(7));
        c.close();
      },
    });
    const out = [];
    for await (const m of parseSse(stream)) out.push(m);
    expect(out).toEqual([
      { event: 'delta', data: '{"text":"a"}' },
      { event: 'end', data: '{"ok":true}' },
    ]);
  });
});

describe('renderPrompt', () => {
  it('fills variables and rejects missing ones', () => {
    expect(renderPrompt('Hi {{ name }}', { name: 'Uzma' })).toBe('Hi Uzma');
    expect(() => renderPrompt('{{x}}', {})).toThrow('Missing prompt variable: x');
  });
});
