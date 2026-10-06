/**
 * Client photo preparation (24 S5-08, 12 §14): resize to at most 1280 px on the long edge and
 * re-encode as JPEG (which drops EXIF, including GPS), stepping the quality down until the file is
 * at most 4 MB. Pure helpers; the native manipulation lives in `api/meal-photo-api.ts`.
 */
export const PHOTO_MAX_EDGE = 1280;
export const PHOTO_MAX_BYTES = 4 * 1024 * 1024;
export const JPEG_QUALITIES = [0.8, 0.7, 0.6, 0.5, 0.4] as const;

/** The resize action for the long edge, or null when the image is already small enough. */
export function resizeFor(
  width: number,
  height: number,
  maxEdge = PHOTO_MAX_EDGE,
): { width: number } | { height: number } | null {
  if (!(width > 0) || !(height > 0)) return { width: maxEdge };
  if (Math.max(width, height) <= maxEdge) return null;
  return width >= height ? { width: maxEdge } : { height: maxEdge };
}

/** Dimensions after `resizeFor` (aspect ratio kept, rounded). */
export function resizedDimensions(
  width: number,
  height: number,
  maxEdge = PHOTO_MAX_EDGE,
): { width: number; height: number } {
  const long = Math.max(width, height);
  if (long <= maxEdge) return { width, height };
  const scale = maxEdge / long;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/**
 * Encodes with descending qualities until `sizeOf(result) <= maxBytes`. Returns the first result
 * that fits, or null when none does (the caller asks for another photo).
 */
export async function encodeWithinLimit<T>(
  encode: (quality: number) => Promise<T>,
  sizeOf: (result: T) => number | null,
  maxBytes = PHOTO_MAX_BYTES,
): Promise<{ result: T; quality: number } | null> {
  for (const quality of JPEG_QUALITIES) {
    const result = await encode(quality);
    const size = sizeOf(result);
    if (size !== null && size <= maxBytes) return { result, quality };
  }
  return null;
}

/** Storage path in `meal-photos` (05 §12.1): {household}/{member}/{yyyy}/{mm}/{meal_log_id}.jpg. */
export function mealPhotoPath(
  householdId: string,
  memberId: string,
  mealLogId: string,
  at: Date,
): string {
  const yyyy = String(at.getUTCFullYear());
  const mm = String(at.getUTCMonth() + 1).padStart(2, '0');
  return `${householdId}/${memberId}/${yyyy}/${mm}/${mealLogId}.jpg`;
}
