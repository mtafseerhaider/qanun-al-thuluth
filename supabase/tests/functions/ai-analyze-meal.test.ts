import { assert, assertEquals, assertFalse, assertMatch } from 'jsr:@std/assert@1';
import { findChildRestrictionViolations } from '@thuluth/ai-core';
import type { FoodEntry } from '@thuluth/ai-core';
import type { ConsentKind } from '@thuluth/shared/domain/consent.ts';

import {
  createAnalyzeMealHandler,
  relativePhotoPath,
} from '../../functions/ai-analyze-meal/handler.ts';
import type { MealLogInsert, MealStore } from '../../functions/ai-analyze-meal/store.ts';
import { chatDeps, textOut } from './chat-fixtures.ts';
import { HH, IBRAHIM, NOW, OWNER, USMAN, VIEWER } from './plan-fixtures.ts';
import { memoryPlatform } from './platform-fixtures.ts';

const ROTI = '00000000-0000-4000-8000-00000000f001';
const KARAHI = '00000000-0000-4000-8000-00000000f002';
const SATAY = '00000000-0000-4000-8000-00000000f003';

const FOODS: FoodEntry[] = [
  {
    kind: 'ingredient',
    id: ROTI,
    names: ['Whole-wheat roti', 'roti', 'chapati'],
    per100g: { kcal: 300, protein_g: 10, carbs_g: 55, fiber_g: 7, fat_g: 4 },
    allergenCodes: ['gluten'],
    halalStatus: 'halal',
  },
  {
    kind: 'recipe',
    id: KARAHI,
    names: ['Chicken karahi'],
    per100g: { kcal: 180, protein_g: 18, carbs_g: 4, fiber_g: 1, fat_g: 10 },
    allergenCodes: [],
  },
  {
    kind: 'recipe',
    id: SATAY,
    names: ['Peanut chicken satay'],
    per100g: { kcal: 250, protein_g: 20, carbs_g: 8, fiber_g: 2, fat_g: 16 },
    allergenCodes: ['peanut'],
  },
];

/** A JPEG header with an EXIF (APP1) segment holding a fake GPS tag, then image data. */
const EXIF_JPEG = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46, 0xff, 0xe1, 0x00, 0x08, 0x47, 0x50, 0x53, 0x21,
  0x21, 0x21, 0xff, 0xdb, 0x00, 0x04, 0x00, 0x00, 0xff, 0xda, 0x00, 0x02, 0x11, 0x22, 0xff, 0xd9,
]);

function setup(
  opts: {
    premium?: boolean;
    consents?: ConsentKind[];
    photo?: Uint8Array | null;
    vision?: Record<string, unknown> | string;
    flags?: Record<string, boolean>;
  } = {},
) {
  const logs: MealLogInsert[] = [];
  const store: MealStore = {
    household: async (id) => (id === HH ? { id: HH, timezone: 'Asia/Karachi' } : null),
    member: async (_h, id) =>
      id === USMAN
        ? {
            id,
            name: 'Usman',
            date_of_birth: '1988-06-01',
            life_stage: 'adult',
            linked_user_id: null,
            allergen_codes: [],
          }
        : id === IBRAHIM
          ? {
              id,
              name: 'Ibrahim',
              date_of_birth: '2018-08-20',
              life_stage: 'child',
              linked_user_id: null,
              allergen_codes: ['peanut'],
            }
          : null,
    activeConsents: async () => opts.consents ?? ['ai_processing', 'health_data', 'child_data'],
    userLocale: async () => 'en',
    downloadPhoto: async () => (opts.photo === undefined ? EXIF_JPEG : opts.photo),
    foods: async () => FOODS,
    insertMealLog: async (row) => {
      logs.push(row);
      return { id: '00000000-0000-4000-8000-0000000000e1' };
    },
  };
  const plat = memoryPlatform({
    roles: { [OWNER]: 'owner', [VIEWER]: 'viewer' },
    premium: opts.premium ?? true,
    flags: opts.flags ?? {},
  });
  const vision = opts.vision ?? {
    isFood: true,
    items: [
      {
        label: 'Chicken karahi',
        searchHint: 'chicken karahi',
        estimatedGrams: 200,
        portionReference: '1 katori',
        confidence: 0.8,
      },
      {
        label: 'Roti',
        searchHint: 'roti',
        estimatedGrams: 80,
        portionReference: '2 small roti',
        confidence: 0.9,
      },
      {
        label: 'Mystery sauce',
        searchHint: 'sauce',
        estimatedGrams: 30,
        portionReference: null,
        confidence: 0.4,
      },
    ],
    plateObservation: { vegFruitFraction: 0.1, proteinFraction: 0.5, grainFraction: 0.4 },
    uncertainties: ['oil amount not visible'],
  };
  const ai = chatDeps((_req, model) =>
    model === 'vision'
      ? textOut(typeof vision === 'string' ? vision : JSON.stringify(vision))
      : undefined,
  );
  const handler = createAnalyzeMealHandler({
    verify: async (jwt) =>
      jwt === 'owner' ? { sub: OWNER } : jwt === 'viewer' ? { sub: VIEWER } : null,
    platform: plat.platform,
    entitlements: plat.entitlements,
    store,
    fallback: ai.fallback,
    writeUsage: ai.writeUsage,
    now: () => NOW,
  });
  return { handler, logs, ai };
}

function analyze(
  body: Record<string, unknown>,
  jwt = 'owner',
  headers: Record<string, string> = {},
) {
  return new Request('http://local/ai-analyze-meal', {
    method: 'POST',
    headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json', ...headers },
    body: JSON.stringify({
      household_id: HH,
      family_member_id: USMAN,
      photo_path: `meal-photos/${HH}/${USMAN}/2026/10/x.jpg`,
      ...body,
    }),
  });
}

Deno.test('ai-analyze-meal adult: DB nutrition, plate feedback, EXIF stripped', async () => {
  const t = setup();
  const res = await t.handler(analyze({}));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.show_numbers, true);
  assertEquals(body.items[0].recipe_id, KARAHI);
  assertEquals(body.items[1].ingredient_id, ROTI);
  assertEquals(body.items[2].recipe_id, null);
  // 200 g karahi (180/100 g) + 80 g roti (300/100 g); the low-confidence item adds nothing.
  assertEquals(body.nutrition.kcal, 600);
  assertEquals(body.thuluth_feedback.tone, 'gentle_suggestion');
  assertEquals(body.meal_log_id, null);
  const call = t.ai.provider.calls.find((c) => c.model === 'vision')!;
  const img = call.req.messages[0]!.content.find((p) => p.type === 'image');
  const bytes = img?.type === 'image' ? (img.data as Uint8Array) : new Uint8Array();
  assertFalse(
    bytes.some((b, i) => b === 0xff && bytes[i + 1] === 0xe1),
    'APP1 removed',
  );
  assert(t.ai.usage.some((u) => u.route_key === 'vision.meal_analysis'));
});

Deno.test('ai-analyze-meal child: no numbers, food-group feedback, allergen warning', async () => {
  const t = setup({
    vision: {
      isFood: true,
      items: [
        {
          label: 'Peanut chicken satay',
          searchHint: 'peanut chicken satay',
          estimatedGrams: 120,
          portionReference: null,
          confidence: 0.8,
        },
      ],
      plateObservation: { vegFruitFraction: 0, proteinFraction: 0.7, grainFraction: 0.3 },
    },
  });
  const res = await t.handler(
    analyze({ family_member_id: IBRAHIM, photo_path: `${HH}/${IBRAHIM}/2026/10/y.jpg` }),
  );
  const body = await res.json();
  assertEquals(body.show_numbers, false);
  assertEquals(body.nutrition, null);
  const fb = [body.thuluth_feedback.headline, ...body.thuluth_feedback.points].join(' ');
  assertFalse(/\d|kcal|calorie/i.test(fb), fb);
  assertEquals(findChildRestrictionViolations(fb).length, 0);
  assertMatch(fb, /allergy list/);
});

Deno.test('ai-analyze-meal save writes a photo_ai meal log with a relative path', async () => {
  const t = setup();
  const res = await t.handler(
    analyze({ save: true }, 'owner', { 'idempotency-key': 'save-key-0001' }),
  );
  const body = await res.json();
  assertEquals(body.meal_log_id, '00000000-0000-4000-8000-0000000000e1');
  assertEquals(t.logs[0]!.source, 'photo_ai');
  assertEquals(t.logs[0]!.photo_path, `${HH}/${USMAN}/2026/10/x.jpg`);
  assertEquals(t.logs[0]!.meal_type, 'lunch');
  const again = await t.handler(
    analyze({ save: true }, 'owner', { 'idempotency-key': 'save-key-0001' }),
  );
  assertEquals(again.headers.get('idempotent-replayed'), 'true');
  assertEquals(t.logs.length, 1);
});

Deno.test('ai-analyze-meal gates and validation', async () => {
  let res = await setup({ premium: false }).handler(analyze({}));
  assertEquals(res.status, 402);
  res = await setup().handler(analyze({}, 'viewer'));
  assertEquals(res.status, 403);
  res = await setup().handler(analyze({ photo_path: `${HH}/${IBRAHIM}/a.jpg` }));
  assertEquals((await res.json()).error.code, 'VALIDATION_FAILED');
  res = await setup().handler(analyze({ photo_path: `${HH}/${USMAN}/../../x.jpg` }));
  assertEquals((await res.json()).error.code, 'VALIDATION_FAILED');
  res = await setup({ photo: null }).handler(analyze({}));
  assertEquals(res.status, 404);
  res = await setup({ photo: new Uint8Array(4 * 1024 * 1024 + 1).fill(0xff) }).handler(analyze({}));
  assertEquals(res.status, 413);
  res = await setup({ photo: new TextEncoder().encode('not an image at all') }).handler(
    analyze({}),
  );
  assertEquals(res.status, 415);
  res = await setup({ flags: { 'ai.vision.enabled': false } }).handler(analyze({}));
  assertEquals((await res.json()).error.code, 'FEATURE_DISABLED');
  res = await setup({ consents: ['ai_processing'] }).handler(analyze({}));
  assertEquals(res.status, 403);
});

Deno.test('ai-analyze-meal not food and invalid model output', async () => {
  let res = await setup({ vision: { isFood: false, items: [] } }).handler(analyze({}));
  const body = await res.json();
  assertEquals(body.items, []);
  assertEquals(body.nutrition, null);
  assertEquals(body.thuluth_feedback.tone, 'neutral');
  res = await setup({ vision: 'not json' }).handler(analyze({}));
  assertEquals(res.status, 502);
  assertEquals((await res.json()).error.code, 'AI_OUTPUT_INVALID');
});

Deno.test('ai-analyze-meal red-flag note stops with SAFETY_ESCALATION', async () => {
  const res = await setup().handler(
    analyze({ text: 'he took his insulin and wants to fast tomorrow' }),
  );
  assertEquals(res.status, 422);
  assertEquals((await res.json()).error.code, 'SAFETY_ESCALATION');
});

Deno.test('ai-analyze-meal relative photo path helper', () => {
  assertEquals(relativePhotoPath('meal-photos/a/b.jpg'), 'a/b.jpg');
  assertEquals(relativePhotoPath('a/b.jpg'), 'a/b.jpg');
});
