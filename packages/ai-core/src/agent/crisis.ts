import type { Locale } from '../guardrails/text.ts';

/**
 * Crisis templates (FR-CHAT-10, 12 §13.1, §8.15). Emergencies never reach the main model: the
 * reply is a fixed, localized template that leads with the country's emergency numbers.
 *
 * Numbers come from `supabase/seed/emergency_contacts.json` (DB lane) when the caller passes them.
 * The built-in fallback holds only the Pakistan numbers the product owner confirmed (Rescue 1122,
 * Edhi 115); any other country without seeded contacts gets "your local emergency number" rather
 * than a number we have not verified. All copy here is PENDING CLINICIAN REVIEW (S5-16).
 */

export interface EmergencyContact {
  label: string;
  number: string;
  kind: 'emergency' | 'urgent_advice' | 'mental_health' | 'other';
}

/** Reviewed fallback (PK only). Everything else must come from the reviewed seed file. */
export const CRISIS_FALLBACK_CONTACTS: Readonly<Record<string, readonly EmergencyContact[]>> = {
  PK: [
    { label: 'Rescue 1122', number: '1122', kind: 'emergency' },
    { label: 'Edhi', number: '115', kind: 'emergency' },
  ],
};

export function contactsFor(
  countryCode: string | null | undefined,
  seeded?: readonly EmergencyContact[] | null,
): EmergencyContact[] {
  if (seeded?.length) return [...seeded];
  return [...(CRISIS_FALLBACK_CONTACTS[(countryCode ?? '').toUpperCase()] ?? [])];
}

export type CrisisKind = 'medical_emergency' | 'self_harm';

function numbersText(contacts: readonly EmergencyContact[], locale: Locale): string {
  const emergency = contacts.filter((c) => c.kind === 'emergency');
  const list = (emergency.length ? emergency : contacts).map((c) =>
    c.label.includes(c.number) ? c.label : `${c.label} ${c.number}`,
  );
  if (!list.length)
    return locale === 'ur' ? 'اپنے ملک کے ایمرجنسی نمبر' : 'your local emergency number';
  return list.join(locale === 'ur' ? ' یا ' : ' or ');
}

/** The crisis reply. Always names the numbers first; no planning, no food advice. */
export function crisisTemplate(
  kind: CrisisKind,
  locale: Locale,
  contacts: readonly EmergencyContact[],
): string {
  const call = numbersText(contacts, locale);
  if (kind === 'self_harm') {
    return locale === 'ur'
      ? `آپ کی حفاظت سب سے اہم ہے۔ اگر آپ یا کوئی اور خطرے میں ہے تو ابھی ${call} پر کال کریں یا قریبی ایمرجنسی میں جائیں۔ کسی قابلِ اعتماد شخص کو ابھی بتائیں اور اکیلے نہ رہیں۔ آپ اکیلے نہیں ہیں، اور مدد موجود ہے۔`
      : `Your safety matters most. If you or someone else is in danger, call ${call} now or go to the nearest emergency department. Please tell someone you trust right now and do not stay alone. You are not alone, and help is available.`;
  }
  return locale === 'ur'
    ? `یہ ایمرجنسی ہو سکتی ہے۔ ابھی ${call} پر کال کریں یا قریبی ایمرجنسی میں جائیں۔ طبی مدد ملنے کے بعد میں کھانے کے بارے میں مدد کر سکتا ہوں۔`
    : `This could be an emergency. Call ${call} now or go to the nearest emergency department. Once you are safe and have medical help, I can help with food questions.`;
}

const SELF_HARM =
  /\b(kill (myself|herself|himself)|end (my|her|his) life|suicid\w*|self[- ]harm|hurt (myself|herself|himself)|want to die)\b|(خودکشی|اپنی جان)/iu;

export function crisisKindOf(text: string): CrisisKind {
  return SELF_HARM.test(text) ? 'self_harm' : 'medical_emergency';
}
