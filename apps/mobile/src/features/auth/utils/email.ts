import { z } from 'zod';

/** Email validation from 02 §7.1.3 and 11 §3.1: trimmed, lower-cased, at most 254 characters. */
export const EmailSchema = z.string().trim().toLowerCase().pipe(z.string().email().max(254));

/** The App Store / Play reviewer account (00 §11). Only this exact address reveals a password field. */
export const REVIEWER_EMAIL = 'reviewer@thuluth.app';

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return EmailSchema.safeParse(email).success;
}

export function isReviewerEmail(email: string): boolean {
  return normalizeEmail(email) === REVIEWER_EMAIL;
}
