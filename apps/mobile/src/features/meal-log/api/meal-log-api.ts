import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import { AiAnalyzeMealRequest, AiAnalyzeMealResponse } from '@shared/contracts';

import { AppError } from '@/lib/supabase/app-error';
import { supabase } from '@/lib/supabase/client';
import { invokeEdge } from '@/lib/supabase/edge';
import { toDbAppError } from '@/lib/supabase/error-mapping';

import { encodeWithinLimit, isAlreadyUploaded, resizeFor } from '../utils/image-rules';
import type { MealLogWrite } from '../utils/meal-log-rules';

/**
 * Meal photo pipeline (24 S5-08, 12 §14, 06 §4.5): prepare the photo on the device, upload it to
 * the private `meal-photos` bucket, call `ai-analyze-meal` with `save = false`, and save the
 * corrected log through PostgREST (outbox). Premium is enforced by the server.
 */
function client() {
  if (!supabase) throw new AppError('NOT_CONFIGURED', 'Supabase is not configured.');
  return supabase;
}

export const MEAL_PHOTOS_BUCKET = 'meal-photos';

/** Resize to 1280 px on the long edge, JPEG (EXIF dropped by re-encoding), at most 4 MB. */
export async function preparePhoto(asset: {
  uri: string;
  width: number;
  height: number;
}): Promise<{ uri: string; width: number; height: number; bytes: number }> {
  const ctx = ImageManipulator.manipulate(asset.uri);
  const resize = resizeFor(asset.width, asset.height);
  if (resize) ctx.resize(resize);
  const image = await ctx.renderAsync();
  const fit = await encodeWithinLimit(
    (quality) => image.saveAsync({ compress: quality, format: SaveFormat.JPEG }),
    (r) => new File(r.uri).size ?? null,
  );
  if (!fit) throw new AppError('PAYLOAD_TOO_LARGE', 'The photo is too large.');
  return {
    uri: fit.result.uri,
    width: fit.result.width,
    height: fit.result.height,
    bytes: new File(fit.result.uri).size ?? 0,
  };
}

/**
 * Meal photos are immutable and keyed by the meal log id, and `meal-photos` has no UPDATE policy (S7-03), so
 * the upload never upserts: a replay after an app kill finds the object already there and counts as done.
 */
export async function uploadMealPhoto(path: string, uri: string): Promise<void> {
  const bytes = await new File(uri).arrayBuffer();
  const { error } = await client()
    .storage.from(MEAL_PHOTOS_BUCKET)
    .upload(path, bytes, { contentType: 'image/jpeg', upsert: false });
  if (error && isAlreadyUploaded(error as { message?: string; statusCode?: unknown })) return;
  if (error)
    throw new AppError('INTERNAL', error.message || 'Photo upload failed.', {
      details: { phase: 'upload' },
    });
}

export function analyzeMeal(req: AiAnalyzeMealRequest): Promise<AiAnalyzeMealResponse> {
  return invokeEdge('ai-analyze-meal', AiAnalyzeMealRequest.parse(req), AiAnalyzeMealResponse);
}

/** Idempotent by row id: a replay after an app kill updates the same row. */
export async function upsertMealLog(w: MealLogWrite): Promise<void> {
  const { error } = await client()
    .from('meal_logs')
    .upsert(
      {
        id: w.id,
        household_id: w.householdId,
        family_member_id: w.familyMemberId,
        eaten_at: w.eatenAt,
        meal_type: w.mealType,
        description: w.description,
        photo_path: w.photoPath,
        estimated_nutrition: w.estimatedNutrition as never,
        fullness_before: w.fullnessBefore,
        fullness_after: w.fullnessAfter,
        source: w.source,
        // Defaults to auth.uid() on the server when not set.
        ...(w.loggedByUserId ? { logged_by_user_id: w.loggedByUserId } : {}),
      },
      { onConflict: 'id' },
    );
  if (error) throw toDbAppError(error);
}
