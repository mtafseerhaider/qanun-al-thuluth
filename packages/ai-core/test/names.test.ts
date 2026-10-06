import { describe, expect, it } from 'vitest';

import { intentRules, runChatTurn } from '../src/agent/index.ts';
import type { TurnArgs } from '../src/agent/index.ts';
import {
  classifyInputRules,
  detectYoungChildFastingRequest,
  findYoungChildFasting,
  foldForNameMatch,
  mentionsName,
  nameAliases,
  nameMatcher,
} from '../src/guardrails/index.ts';
import type { AiUsageInsert } from '../src/metering/usage.ts';
import { adjustSafetyEscalation } from '../src/planning/adjust.ts';
import type { PlanMember } from '../src/planning/types.ts';
import { FakeProvider } from '../src/providers/fake.ts';
import { RouteResolver } from '../src/router/route-resolver.ts';
import type { AiModelRouteRow } from '../src/router/route-resolver.ts';

const ZWNJ = String.fromCharCode(0x200c);
const ZWJ = String.fromCharCode(0x200d);
const TATWEEL = String.fromCharCode(0x0640);
const FATHA = String.fromCharCode(0x064e);
const KASRA = String.fromCharCode(0x0650);

describe('script-aware member name matching', () => {
  it('matches a name written in Urdu script (\\b never did)', () => {
    expect(mentionsName('حنا کو رات کے کھانے میں کیا دیں؟', ['حنا'])).toBe(true);
    expect(mentionsName('کیا حنا، ابراہیم اور مریم کو دال پسند ہے؟', ['مریم'])).toBe(true);
    expect(mentionsName('حنا', ['حنا'])).toBe(true);
    // Latin names keep working, including possessives.
    expect(mentionsName("Make Hina's portions smaller", ['Hina'])).toBe(true);
    expect(mentionsName('hina ko kya dein', ['Hina'])).toBe(true);
  });

  it('does not match inside a longer word in either script', () => {
    expect(mentionsName('Alina wants rice', ['Ali'])).toBe(false);
    expect(mentionsName('Khalid wants rice', ['Ali'])).toBe(false);
    expect(mentionsName('علیم کو چاول دیں', ['علی'])).toBe(false);
    expect(mentionsName('حنائی رنگ', ['حنا'])).toBe(false);
    expect(mentionsName('علی کو چاول دیں', ['علی'])).toBe(true);
  });

  it('folds alef, yeh, heh, kaf and noon variants', () => {
    // Urdu gol heh vs Arabic heh vs teh marbuta.
    expect(mentionsName('عائشه کو دودھ دیں', ['عائشہ'])).toBe(true);
    expect(mentionsName('عائشة کو دودھ دیں', ['عائشہ'])).toBe(true);
    // Arabic yeh and alef maksura vs Urdu yeh.
    expect(mentionsName('علي کو چاول دیں', ['علی'])).toBe(true);
    expect(mentionsName('عیسى کو چاول دیں', ['عیسی'])).toBe(true);
    // Alef with madda / hamza vs bare alef.
    expect(mentionsName('امنہ کو چاول دیں', ['آمنہ'])).toBe(true);
    expect(mentionsName('أمنہ کو چاول دیں', ['آمنہ'])).toBe(true);
    // Arabic kaf vs Urdu keheh.
    expect(mentionsName('زكریا کو چاول دیں', ['زکریا'])).toBe(true);
    // Do-chashmi heh typed for gol heh.
    expect(mentionsName('فاطمھ کو چاول دیں', ['فاطمہ'])).toBe(true);
  });

  it('strips diacritics, tatweel and zero-width characters', () => {
    expect(mentionsName(`ع${FATHA}ل${KASRA}ی کو چاول دیں`, ['علی'])).toBe(true);
    expect(mentionsName(`ح${TATWEEL}نا کو چاول دیں`, ['حنا'])).toBe(true);
    expect(mentionsName(`ح${ZWNJ}نا کو چاول دیں`, ['حنا'])).toBe(true);
    expect(mentionsName('حنا کو چاول دیں', [`ح${ZWJ}نا`])).toBe(true);
    // Arabic presentation forms (NFKC) and Latin accents.
    const presentation = String.fromCharCode(0xfea3, 0xfee8, 0xfe8e);
    expect(mentionsName(`${presentation} کو چاول دیں`, ['حنا'])).toBe(true);
    expect(mentionsName('Zoe wants rice', ['Zoë'])).toBe(true);
  });

  it('treats a nickname in brackets, after a slash or a comma as an alias', () => {
    expect(nameAliases('Hina (حنو)')).toEqual(['hina حنو', 'hina', 'حنو']);
    const m = nameMatcher(['Hina (حنو)', 'Ibrahim / ابراہیم', 'Maryam، مِمی']);
    expect(m('حنو کو کیا دیں؟')).toBe(true);
    expect(m('Hina wants rice')).toBe(true);
    expect(m('ابراهیم کو چاول دیں')).toBe(true);
    expect(m('ممی کو دودھ دیں')).toBe(true);
    expect(m('Ahmed wants rice')).toBe(false);
    // One-letter parts and empty names never match everything.
    expect(nameMatcher(['', null, undefined, 'A'])('A big plate')).toBe(false);
  });

  it('folds digits and whitespace consistently', () => {
    expect(foldForNameMatch('  Hina   ۵  ')).toBe('hina 5');
    expect(mentionsName('Hina  Fatima wants rice', ['Hina Fatima'])).toBe(true);
  });
});

describe('Urdu-script names in reply scoping', () => {
  it('fasting under 7: an Urdu-script young name is recognised in drafts and requests', () => {
    const young = ['حنا'];
    expect(
      findYoungChildFasting('حنا سحری سے افطار تک روزہ رکھ سکتی ہے۔', { youngNames: young }),
    ).not.toHaveLength(0);
    expect(
      findYoungChildFasting(`ح${ZWNJ}نا روزہ رکھ سکتی ہے۔`, { youngNames: young }),
    ).not.toHaveLength(0);
    expect(detectYoungChildFastingRequest('حنا روزہ رکھنا چاہتی ہے', { youngNames: young })).toBe(
      true,
    );
    // An adult's fast is not about the young child.
    expect(findYoungChildFasting('ابو روزہ رکھ سکتے ہیں۔', { youngNames: young })).toHaveLength(0);
  });

  it('intent routing keeps a turn naming a member in Urdu script full', () => {
    const d = intentRules({
      text: 'حنا کیا کھائے',
      classification: classifyInputRules('حنا کیا کھائے'),
      aboutMinor: false,
      hasImages: false,
      hasHistory: false,
      memberNames: ['حنا'],
    });
    expect(d).toMatchObject({ intent: 'full', reason: 'member_named' });
  });

  it('plan adjustments scope a restriction to the minor named in Urdu script', () => {
    const member = (id: string, name: string, ageMonths: number): PlanMember => ({
      id,
      name,
      ageMonths,
      lifeStage: ageMonths >= 216 ? 'adult' : 'child',
      allergies: [],
      dislikes: [],
      likes: [],
      safeFoods: [],
      modules: [],
      medicationFlags: [],
      goals: [],
      energyTargetKcal: null,
    });
    const members = [
      member('a', 'Usman', 420),
      member('h', 'Hina (حنا)', 60),
      member('i', 'Ibrahim', 120),
    ];
    const esc = adjustSafetyEscalation('حنا کو کم کھلائیں', members, null, 'ur');
    expect(esc).toMatchObject({ family_member_id: 'h', recommend: 'see_pediatrician' });
  });

  it('a chat turn about a minor named in Urdu script is scoped to the child', async () => {
    const routes = (k: string): AiModelRouteRow[] => [
      { route_key: k, provider: 'anthropic', model: k, params: {}, priority: 1, enabled: true },
    ];
    const provider = new FakeProvider({
      script: () => ({
        content: [{ type: 'text', text: 'حنا کا وزن کم کرنے کے لیے کھانا کم کر دیں۔' }],
      }),
    });
    const usage: AiUsageInsert[] = [];
    const args: TurnArgs = {
      text: 'حنا کو رات کے کھانے میں کیا دیں؟',
      locale: 'ur',
      countryCode: 'PK',
      tier: 'free',
      routeKey: 'chat.free',
      maxSteps: 2,
      maxOutputTokens: 800,
      system: 'system',
      contextBlocks: ['<household_snapshot></household_snapshot>'],
      history: [],
      tools: [],
      executeTool: async () => ({ ok: true, data: {} }),
      minorNames: ['حنا'],
      youngChildNames: ['حنا'],
      metadata: {
        requestId: '00000000-0000-4000-8000-000000000001',
        userId: 'u',
        householdId: null,
        promptKey: 'chat.system',
        promptVersion: 1,
        tier: 'free',
      },
      deps: {
        fallback: {
          resolver: new RouteResolver(async (k) => routes(k)),
          providers: { anthropic: provider },
          sleep: async () => {},
        },
        writeUsage: async (r) => void usage.push(r),
      },
    };
    const out = await runChatTurn(args, () => {});
    expect(out.aboutMinor).toBe(true);
    expect(out.text).not.toMatch(/وزن\s*کم/u);
    expect(out.safetyFlags).toContain('child_restriction_blocked');
  });
});
