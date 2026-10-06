/**
 * Eval runner skeleton (S0-15). Runs JSONL cases through a provider and applies regex checks.
 * Usage: pnpm --filter @thuluth/ai-core evals [--suite smoke] [--live]
 * Without --live it uses the deterministic FakeProvider so CI needs no API keys. LLM-judge rubrics
 * and the full 600-case suite arrive with the safety guardrails in Sprint 2 (21 §9).
 */
import { readFileSync } from 'node:fs';

import { AnthropicProvider } from '../src/providers/anthropic.ts';
import { FakeProvider } from '../src/providers/fake.ts';
import type { AIProvider, RouteKey } from '../src/types.ts';
import { textOf } from '../src/types.ts';

interface EvalCase {
  id: string;
  route: RouteKey;
  prompt: string;
  checks: { must_match?: string[]; must_not_match?: string[] };
}

function regex(source: string): RegExp {
  const insensitive = source.startsWith('(?i)');
  return new RegExp(insensitive ? source.slice(4) : source, insensitive ? 'i' : '');
}

const args = process.argv.slice(2);
const suiteIndex = args.indexOf('--suite');
const suite = suiteIndex >= 0 ? (args[suiteIndex + 1] ?? 'smoke') : 'smoke';
const live = args.includes('--live');
const provider: AIProvider = live
  ? new AnthropicProvider()
  : new FakeProvider({
      script: () => ({
        content: [{ type: 'text', text: 'Salaam! Children are never restricted.' }],
      }),
    });

const cases = readFileSync(new URL(`./datasets/${suite}.jsonl`, import.meta.url), 'utf8')
  .split('\n')
  .filter((line) => line.trim())
  .map((line) => JSON.parse(line) as EvalCase);

let failed = 0;
for (const c of cases) {
  const res = await provider.chat(
    {
      route: c.route,
      system: [{ type: 'text', text: 'You are Thuluth, a family nutrition companion.' }],
      messages: [{ role: 'user', content: [{ type: 'text', text: c.prompt }] }],
      maxOutputTokens: 400,
      metadata: {
        requestId: crypto.randomUUID(),
        userId: 'eval',
        householdId: null,
        promptKey: 'eval',
        promptVersion: 1,
        tier: 'premium',
      },
    },
    'claude-sonnet-5-5',
    { timeoutMs: 60_000, priceInPerMTokUsd: 0, priceOutPerMTokUsd: 0 },
  );
  const text = textOf(res.content);
  const problems = [
    ...(c.checks.must_match ?? []).filter((r) => !regex(r).test(text)).map((r) => `missing ${r}`),
    ...(c.checks.must_not_match ?? [])
      .filter((r) => regex(r).test(text))
      .map((r) => `matched forbidden ${r}`),
  ];
  if (problems.length) failed++;
  console.log(
    `${problems.length ? 'FAIL' : 'PASS'} ${c.id}${problems.length ? `: ${problems.join('; ')}` : ''}`,
  );
}
console.log(
  `${cases.length - failed}/${cases.length} passed (${live ? 'live' : 'fake'} provider, suite ${suite})`,
);
if (failed) process.exit(1);
