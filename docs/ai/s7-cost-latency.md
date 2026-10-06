# S7-02 AI cost and latency pass

Status: implemented in `packages/ai-core` and ai-chat, simulated, not yet measured live.
Owner: AI lane. Related: NFR 9.8 (01-product-requirements), 12-ai-agent-architecture §5, §17.

The cost-cap defaults were **not** changed. They wait for the product owner (see "Decisions needed").

## 1. What changed

| Lever | Where | Effect |
| --- | --- | --- |
| Anthropic prompt caching on the stable prefix | `src/providers/anthropic.ts` | `cache_control` goes on the last tool definition (tools are always sent, so the cache prefix stays stable), on the system prompt and on the first context block. There are at most 4 breakpoints, and one is kept back for the conversation tail. |
| Conversation-tail breakpoint | `ChatRequest.cacheTail`, set by `runChatTurn` | Each step of the tool loop reads the previous step's prefix from cache instead of paying full input price again. |
| Tools kept on the last step | anthropic, openai, gemini adapters | On the final step, tool definitions are still sent with `tool_choice: none` (Gemini: `toolConfig NONE`). Before, they were dropped, which broke the cached prefix exactly on the most expensive step. |
| OpenAI automatic caching | `src/providers/openai.ts` | Stable prefix order (instructions, tools, then history) plus `prompt_cache_key = thuluth:<route>:<promptKey>@<version>:<tier>`. |
| Cheap intent routing | `src/agent/intent.ts`, `runChatTurn` | Rules first. Greetings, thanks, acknowledgements and short general questions count as **light** and go to `chat.free` (Haiku 4.5) with 1 step, no tools, a small output cap and a short history. Any safety, child, fiqh, household, plan, quantity, Islamic, image or named-member signal makes a turn **full**. Only ambiguous turns call `classify.intent`, and that call fails safe to full. |
| Output caps per route | `effectiveMaxOutputTokens` in all three adapters | The cap sent is `min(route cap, turn cap)`. Light caps: free 350, premium 450. `TURN_LIMITS` are unchanged (free 4 steps / 800, premium 6 / 1500). |
| History and context trimming | `trimHistory`, `TURN_BUDGETS` | Full turns keep 1500 history tokens on free and 4000 on premium; light turns keep 600 and 1000. Any single message is capped at 2400 characters, and the oldest messages are dropped first. |
| Speculative first step | `runChatTurn` (`speculativeFirstStep`) | While the Haiku safety classifier runs, the first model step starts in parallel. If the classifier changes the safety, child or fiqh decision, or the intent, the speculative step is aborted and discarded. Rule-flagged turns never speculate. |
| Thinking and effort on `chat.default` | `140_ai_model_routes.sql`, anthropic adapter | Sonnet 5.5 runs with `effort: low` and `thinking: between_tools`, so thinking tokens neither eat into the 1500-token reply cap nor bill on every turn. `temperature` is dropped for models that reject sampling parameters (Sonnet 5.x, Opus 4.7+/5.x). |
| Thinking-block replay | `opaque` ContentPart | Thinking and redacted-thinking blocks are passed back unchanged inside a tool loop, and only to the same provider and model. |
| Usage rows | `toUsageRow`, `chatMetered` | `cache_read_tokens`, `cache_write_tokens`, `prompt_key` and `prompt_version` are now filled in. The columns already existed. |

Free chat stays on the cheapest model with strict caps (project decision).

## 2. Simulation

`pnpm --filter @thuluth/ai-core cost:sim` (add `--json <file>` to get every number). The simulation is deterministic and needs no keys or network.

- Every prompt in the eval datasets, plus a greeting and a thanks per session, goes through the real `runChatTurn`: classifier, intent routing, guardrails and metering.
- A simulated Anthropic provider renders the real `toAnthropicBody` request and counts tokens with `estimateTokens` (4 characters per token for Latin text, 2 for Urdu script).
- It simulates the cache with a 5-minute TTL, 4 breakpoints, the per-model minimum prefix (4096 tokens on Haiku 4.5, 512 on Sonnet 5.5 and Opus 5.5) and a 20-block lookback.
- Costs use the `toUsageRow` arithmetic.
- **baseline** is Sprint 6 behaviour: no intent routing, full history, no tail breakpoint, and tools dropped on the last step. **s7** is this sprint.

Traffic: 344 messages in 63 sessions; 290 reach a model and 54 are answered by a safety template.

Two cache scenarios are simulated:
- **Cold:** sessions are 15 minutes apart, so no cache is reused across users. This is the launch-week floor.
- **Warm:** a session starts every 30 seconds for the same tier, so the shared prefix stays cached.

### Per message

| Tier | Cache | Config | Avg / message | p95 / message | Light turns | Cache-read share of input | Modeled TTFT p50 / p95 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| free | cold | baseline | $0.00429 | $0.00695 | 0 | 65% | 3.37 s / 3.37 s |
| free | cold | s7 | **$0.00368** (-14%) | $0.00914 | 94 | 67% | **2.76 s** / 2.90 s |
| free | warm | baseline | $0.00327 | $0.00595 | 0 | 78% | 3.37 s / 3.37 s |
| free | warm | s7 | **$0.00282** (-14%) | $0.00470 | 94 | 79% | **2.76 s** / 2.76 s |
| premium | cold | baseline | $0.00829 | $0.01460 | 0 | 68% | 6.29 s / 6.29 s |
| premium | cold | s7 | **$0.00660** (-20%) | $0.01909 | 94 | 69% | **5.68 s** / 5.95 s |
| premium | warm | baseline | $0.00618 | $0.01162 | 0 | 80% | 6.29 s / 6.29 s |
| premium | warm | s7 | **$0.00479** (-22%) | $0.00907 | 94 | 81% | **5.68 s** / 5.68 s |

Notes on the table:
- **Time to first token** falls by about 0.6 s at p50 on both tiers. The speculative first step hides the classifier latency, and light turns run on Haiku.
- **Cold-cache p95 rises.** The tail breakpoint is written at 1.25x on a session's first tool-loop turn: 452k write tokens under s7 versus 344k under baseline. With a cold cache, that write is only read back within the same turn, so the single most expensive messages cost more while the average falls. With a warm cache, p95 falls too: free -21%, premium -22%.
- **Output tokens** fall from 76.0k to 63.3k, from the light caps and light routing. **Input tokens** fall from 2.45M to 2.09M on free and from 2.65M to 2.26M on premium, from history budgets.
- **Haiku caching.** On Haiku 4.5 the free tools and system prefix is about 4.05k tokens, right at the 4096-token minimum. The shared prefix on `chat.free` therefore sometimes fails to cache. Adding a few hundred tokens of stable content, or caching the first context block together with system, would make it reliable. Measure this with live `cache_read_tokens`.

### Per MAU (usage profile, an assumption until beta data exists)

The profile:
- **Free:** 8 active days a month, 4 messages a day, 2 plan personalisations, 0.25 intakes.
- **Premium:** 18 active days, 8 messages a day, 3 plan generations (Opus), 4 plan adjustments, 10 photos, 18 memory summaries, 0.25 intakes.

Non-chat calls are modelled with 30% cached input. The full list is `CALLS` in the script.

| Config | Cache | Free MAU (target $0.15) | of which chat | Premium MAU (target $1.20) | of which chat |
| --- | --- | --- | --- | --- | --- |
| baseline | cold | $0.218 | $0.137 | $1.944 | $1.193 |
| baseline | warm | $0.185 | $0.105 | $1.641 | $0.889 |
| s7 | cold | $0.199 | $0.118 | $1.701 | $0.950 |
| s7 | warm | **$0.171** | $0.090 | **$1.442** | $0.690 |

Even after S7-02, **both tiers are still over target under this profile**:
- **Free:** chat is now $0.09–0.12. The other $0.081 is plan personalisation on Sonnet (2 a month). Free chat alone fits the target.
- **Premium:** non-chat costs about $0.75 a month. Opus `plan.generate` dominates at about $0.16 per plan. Chat is $0.69–0.95.

Recommendations follow. None is implemented, because each needs evals or a product decision.
1. Run `plan.generate` on Opus 5.5 with `effort: medium` and a smaller catalog slice, or make Sonnet 5.5 primary with Opus as fallback. This is the largest single lever, roughly $0.25–0.35 per premium MAU. Gate it on the plan-quality evals.
2. Move free plan personalisation to Haiku, or cache the catalog block properly; it needs at least 4096 tokens to cache on Haiku.
3. Send a tool subset on free light-adjacent turns (search and sources only). This shrinks the cached prefix and the cost of a cache write.
4. Replace the profile above with real `ai_usage` aggregates after two weeks of beta, then re-run.

### Daily ceilings (s7, cold cache, p95 message cost)

| Check | Value |
| --- | --- |
| Free: 20 messages (daily message cap) at p95 cost | $0.183, against a $0.05 ceiling. The cost ceiling binds first, after about 5 messages at p95 and about 13 at the average. |
| Premium: messages until the NFR 9.8 ceiling ($0.60) | 31 |
| Premium: messages until the code default ($1.00) | 52 |
| Premium heavy day without chat (15 photos, 20 adjustments, 2 plans) | $1.076, above both ceilings |

The per-user daily ceilings hold. ai-chat enforces them before each turn, and a free user is degraded or blocked long before the cost becomes material. They do not line up with the product numbers, though. See below.

## 3. Decisions needed (product owner)

1. **Premium daily ceiling.** NFR 9.8 says $0.60 a day. The ai-chat `DEFAULT_COST_CAPS` premium value is 1,000,000 micros ($1.00). Pick one and align the code or the NFR. The value was not touched here.
2. **Free daily ceiling vs message cap.** At $0.05 a day the cost ceiling, not the 20-message cap, decides how much a free user can chat: about 5–13 messages. Either accept that and change the copy shown to users, or raise the free ceiling to about $0.10.
3. **Per-MAU targets** are not met under the assumed profile on either tier. Accept the recommendations above, or revisit the targets once beta data exists.

## 4. Known gaps

- ~~The `message.start` stream event announces `model_route` before intent routing runs.~~ Fixed in the launch follow-up, with no contract change. `runChatTurn` now emits an internal `route` event once safety classification and intent routing have decided. ai-chat sends `message.start` on that event, so a light turn announces `chat.free`. A turn that fails before routing announces the tier's route ahead of its `error` event. The reply is still released only after the output validators, so the first `message.delta` arrives at the same time as before. Only `message.start` itself moves later, by the context build plus the classifier, usually a few hundred milliseconds. Replays of a stored reply still announce the tier's route, because the route is not stored on `chat_messages`.
- These numbers are a simulation. Before trusting them, verify live:
  - cache hits (`cache_read_tokens`) on Haiku and Sonnet;
  - thinking-block replay inside tool loops on Sonnet 5.5;
  - that `effort: low` and `thinking: between_tools` keep chat quality, by running `evals --live` on `chat.default`;
  - light-routing quality on Haiku, by sampling about 50 light turns.
