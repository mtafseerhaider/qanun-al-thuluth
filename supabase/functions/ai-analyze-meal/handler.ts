import {
  AIError,
  analyzeMealImage,
  classifyInput,
  matchItems,
  nutritionFor,
  overallConfidence,
  plateSplitOf,
  RED_FLAG_REFERRAL,
  sniffImageType,
  stripJpegMetadata,
  thuluthFeedback,
} from '@thuluth/ai-core';
import type { AiUsageInsert, FallbackDeps, RequestMetadata } from '@thuluth/ai-core';
import {
  AiAnalyzeMealRequest,
  AiAnalyzeMealResponse,
} from '@thuluth/shared/contracts/ai-analyze-meal.ts';
import type { ConsentKind } from '@thuluth/shared/domain/consent.ts';

import { requireUser } from '../_shared/auth.ts';
import type { ClaimsVerifier } from '../_shared/auth.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { sha256Hex } from '../_shared/crypto.ts';
import { consumeTierQuota, requirePremium, resolveEntitlement } from '../_shared/entitlements.ts';
import type { EntitlementStore } from '../_shared/entitlements.ts';
import { HttpError } from '../_shared/errors.ts';
import { jsonHandler } from '../_shared/http.ts';
import type { PlatformStore } from '../_shared/platform.ts';
import { ageMonthsOn, localDate } from '../_shared/plan/pipeline.ts';
import type { MealStore } from './store.ts';

export const SCOPE = 'ai-analyze-meal';
/** The client resizes to 1280 px JPEG q80 (12 §14); anything bigger is refused, not resized. */
export const PHOTO_MAX_BYTES = 4 * 1024 * 1024;
const BUCKET_PREFIX = 'meal-photos/';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AnalyzeMealDeps {
  verify: ClaimsVerifier;
  platform: Pick<
    PlatformStore,
    | 'membership'
    | 'featureEnabled'
    | 'consumeRateLimit'
    | 'idempotencyBegin'
    | 'idempotencyComplete'
    | 'idempotencyFail'
  >;
  entitlements: Pick<EntitlementStore, 'userPremium' | 'householdPremium'>;
  store: MealStore;
  fallback: FallbackDeps;
  writeUsage: (row: AiUsageInsert) => Promise<void>;
  /** Run `classify.safety` on the optional note (default true). */
  classifyWithModel?: boolean;
  now?: () => Date;
}

/** Photo path relative to the bucket (`meal_logs.photo_path` form), with or without the prefix. */
export function relativePhotoPath(path: string): string {
  return path.startsWith(BUCKET_PREFIX) ? path.slice(BUCKET_PREFIX.length) : path;
}

function mealTypeAt(now: Date, timezone: string): 'breakfast' | 'lunch' | 'snack' | 'dinner' {
  let hour = now.getUTCHours();
  try {
    hour = Number(
      new Intl.DateTimeFormat('en-GB', {
        timeZone: timezone,
        hour: '2-digit',
        hour12: false,
      }).format(now),
    );
  } catch {
    // UTC fallback
  }
  if (hour < 11) return 'breakfast';
  if (hour < 16) return 'lunch';
  if (hour < 19) return 'snack';
  return 'dinner';
}

/**
 * 06 §4.5, 12 §14. Premium (Q-09: the caller's or a household's premium). Nutrition comes from the
 * database scaled by the estimated grams, never from the model. For members under 18 the response
 * carries no numbers (`show_numbers = false`, `nutrition = null`) and food-group feedback only.
 */
export function createAnalyzeMealHandler(deps: AnalyzeMealDeps) {
  const now = deps.now ?? (() => new Date());

  return jsonHandler(AiAnalyzeMealRequest, async ({ req, input, requestId }) => {
    const user = await requireUser(req, deps.verify);
    const role = await deps.platform.membership(input.household_id, user.userId);
    if (!role) throw new HttpError('NOT_FOUND', 'Household not found.');
    const eater = await deps.store.member(input.household_id, input.family_member_id);
    if (!eater) throw new HttpError('NOT_FOUND', 'Family member not found.');
    // 06 §4.5: members the caller can write logs for (editors, or their own linked profile).
    if (role !== 'owner' && role !== 'caregiver' && eater.linked_user_id !== user.userId) {
      throw new HttpError('FORBIDDEN', 'You cannot log meals for this family member.');
    }
    const ent = await resolveEntitlement(deps.entitlements, {
      userId: user.userId,
      householdId: input.household_id,
      scope: 'household_or_personal',
    });
    requirePremium(ent, 'meal.photo_analysis', 'Photo meal analysis needs Premium.');
    if (!(await deps.platform.featureEnabled('ai.vision.enabled'))) {
      throw new HttpError('FEATURE_DISABLED', 'Photo analysis is paused right now.', {
        flag: 'ai.vision.enabled',
      });
    }
    const path = relativePhotoPath(input.photo_path);
    const segments = path.split('/');
    if (
      segments.length < 3 ||
      segments.some((s) => !s || s === '.' || s === '..') ||
      segments[0]?.toLowerCase() !== input.household_id.toLowerCase() ||
      segments[1]?.toLowerCase() !== input.family_member_id.toLowerCase()
    ) {
      throw new HttpError(
        'VALIDATION_FAILED',
        'The photo must be in this household’s folder for this member.',
        { field: 'photo_path' },
      );
    }
    const household = await deps.store.household(input.household_id);
    if (!household) throw new HttpError('NOT_FOUND', 'Household not found.');
    const today = localDate(now(), household.timezone);
    const minor = ageMonthsOn(eater.date_of_birth, today, eater.life_stage) < 216;

    const required: ConsentKind[] = ['ai_processing', 'health_data'];
    if (minor) required.push('child_data');
    const granted = new Set(await deps.store.activeConsents(user.userId, input.household_id));
    const missing = required.filter((k) => !granted.has(k));
    if (missing.length) {
      throw new HttpError(
        'CONSENT_REQUIRED',
        'Please accept the consents needed for photo analysis.',
        {
          consents: missing,
        },
      );
    }
    const header = req.headers.get('accept-language')?.slice(0, 2);
    const locale =
      (header === 'ur' || header === 'en' ? header : await deps.store.userLocale(user.userId)) ===
      'ur'
        ? 'ur'
        : 'en';

    // Optional idempotency when saving (06 §4.5).
    const key = req.headers.get('idempotency-key')?.trim() ?? '';
    let idem: string | null = null;
    if (input.save && key) {
      if (key.length < 8 || key.length > 128) {
        throw new HttpError('VALIDATION_FAILED', 'Idempotency-Key must be 8 to 128 characters.', {
          header: 'Idempotency-Key',
        });
      }
      const begin = await deps.platform.idempotencyBegin(
        SCOPE,
        user.userId,
        key,
        await sha256Hex(JSON.stringify(input)),
      );
      if (begin.state === 'replay') {
        return Response.json(begin.body, {
          status: begin.status,
          headers: { ...corsHeaders, 'idempotent-replayed': 'true' },
        });
      }
      if (begin.state === 'mismatch') {
        throw new HttpError(
          'IDEMPOTENCY_KEY_REUSED',
          'This request key was used for a different request.',
        );
      }
      if (begin.state === 'in_progress') {
        throw new HttpError('IDEMPOTENCY_IN_PROGRESS', 'This photo is still being analysed.', {
          retry_after_seconds: 3,
        });
      }
      idem = begin.id;
    }

    try {
      const headers = {
        ...corsHeaders,
        ...(await consumeTierQuota(deps.platform, SCOPE, user.userId, ent.tier)),
      };
      const body = await analyse();
      if (idem) await deps.platform.idempotencyComplete(idem, 200, body);
      return Response.json(body, { headers });
    } catch (err) {
      if (idem) await deps.platform.idempotencyFail(idem).catch(() => {});
      throw err;
    }

    async function analyse() {
      const raw = await deps.store.downloadPhoto(path);
      if (!raw)
        throw new HttpError('NOT_FOUND', 'The photo was not found. Please upload it again.');
      if (raw.byteLength > PHOTO_MAX_BYTES) {
        throw new HttpError('PAYLOAD_TOO_LARGE', 'The photo is too large. Please try again.', {
          max_bytes: PHOTO_MAX_BYTES,
        });
      }
      const type = sniffImageType(raw);
      if (type !== 'image/jpeg' && type !== 'image/png' && type !== 'image/webp') {
        throw new HttpError('UNSUPPORTED_MEDIA_TYPE', 'Please send the photo as a JPEG.', {
          accepted: ['image/jpeg', 'image/png', 'image/webp'],
        });
      }
      const analysisId = UUID.test(requestId) ? requestId : crypto.randomUUID();
      const metadata: RequestMetadata = {
        requestId: analysisId,
        userId: user.userId,
        householdId: input.household_id,
        promptKey: 'vision.meal',
        promptVersion: 1,
        tier: 'premium',
      };
      let note = input.text?.trim() || undefined;
      if (note) {
        const c = await classifyInput(
          note,
          deps.classifyWithModel === false
            ? undefined
            : { fallback: deps.fallback, writeUsage: deps.writeUsage, metadata },
        );
        if (c.safety === 'emergency' || (c.safety === 'red_flag' && !c.child_weight_request)) {
          throw new HttpError('SAFETY_ESCALATION', RED_FLAG_REFERRAL[locale], {
            categories: c.categories,
          });
        }
        // Child weight or restriction notes are not passed to the model.
        if (c.child_weight_request || c.safety !== 'ok') note = undefined;
      }
      // 12 §14 step D: metadata (EXIF, GPS) is stripped before the image leaves the server.
      const image = type === 'image/jpeg' ? stripJpegMetadata(raw) : raw;
      const { result } = await analyzeMealImage({
        image,
        mediaType: type,
        note,
        metadata,
        deps: { fallback: deps.fallback, writeUsage: deps.writeUsage },
      }).catch((err) => {
        if (!(err instanceof AIError)) throw err;
        if (err.code === 'SCHEMA_VALIDATION_FAILED') {
          throw new HttpError(
            'AI_OUTPUT_INVALID',
            'The photo could not be read. Please try again.',
          );
        }
        throw new HttpError(
          err.code === 'TIMEOUT' || /TIMEOUT/.test(err.message) ? 'AI_TIMEOUT' : 'AI_UNAVAILABLE',
          'Photo analysis is not available right now. Please try again.',
        );
      });
      const foods = result.isFood ? await deps.store.foods(input.household_id) : [];
      const matched = result.isFood ? matchItems(result.items, foods) : [];
      const split = plateSplitOf(result.plateObservation);
      const allergenLabels = matched
        .filter((m) => m.entry?.allergenCodes.some((c) => eater!.allergen_codes.includes(c)))
        .map((m) => m.label);
      const feedback = thuluthFeedback({
        isFood: result.isFood,
        split,
        minor,
        locale,
        allergenLabels,
      });
      const nutrition = minor ? null : nutritionFor(matched);
      const items = matched.map((m) => ({
        label: m.label,
        ingredient_id: m.ingredientId,
        recipe_id: m.recipeId,
        estimated_grams: Math.max(1, m.estimatedGrams),
        ...(m.householdMeasure ? { household_measure: m.householdMeasure } : {}),
        confidence: m.confidence,
        ...(m.entry?.halalStatus === 'depends_on_source' || m.entry?.halalStatus === 'mashbooh'
          ? {
              halal_note:
                locale === 'ur'
                  ? 'حلال ہونا ذریعے پر منحصر ہے؛ خریداری کی جگہ دیکھ لیں۔'
                  : 'Halal status depends on the source; check where it was bought.',
            }
          : {}),
      }));
      let mealLogId: string | null = null;
      if (input.save && result.isFood) {
        const saved = await deps.store.insertMealLog({
          household_id: input.household_id,
          family_member_id: input.family_member_id,
          eaten_at: input.eaten_at ?? now().toISOString(),
          meal_type: input.meal_type ?? mealTypeAt(now(), household!.timezone),
          description: items
            .map((i) => i.label)
            .join(', ')
            .slice(0, 2000),
          photo_path: path,
          estimated_nutrition: {
            items: items.map((i) => ({
              label: i.label,
              grams: i.estimated_grams,
              confidence: i.confidence,
            })),
            ...(nutrition ?? {}),
            plate_split: split,
            thuluth_feedback: feedback.headline,
          },
          source: 'photo_ai',
          logged_by_user_id: user.userId,
        });
        mealLogId = saved.id;
      }
      return AiAnalyzeMealResponse.parse({
        analysis_id: analysisId,
        items,
        nutrition,
        show_numbers: !minor,
        plate_split: split,
        thuluth_feedback: feedback,
        overall_confidence: overallConfidence(matched),
        meal_log_id: mealLogId,
      });
    }
  });
}
