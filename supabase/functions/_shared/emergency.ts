import type { EmergencyContact } from '@thuluth/ai-core';

import seed from '../../seed/emergency_contacts.json' with { type: 'json' };

/**
 * Emergency numbers for crisis replies (FR-CHAT-10, 12 §8.15), read from the DB lane's reviewed
 * seed file `supabase/seed/emergency_contacts.json` (bundled at deploy time). Countries without a
 * seeded entry fall back to ai-core's built-in list (Pakistan only), else "your local emergency
 * number". The seed is PENDING CLINICIAN REVIEW (S5-16).
 */

interface SeedContact {
  service: string;
  label: string;
  number: string;
  kind: string;
}

const KIND: Record<string, EmergencyContact['kind']> = {
  emergency: 'emergency',
  ambulance: 'emergency',
  urgent_advice: 'urgent_advice',
  mental_health: 'mental_health',
};

const COUNTRIES = (seed as { countries?: Record<string, SeedContact[]> }).countries ?? {};

/** Seeded contacts for an ISO country code; null when the seed has none. */
export function seededEmergencyContacts(
  countryCode: string | null | undefined,
): EmergencyContact[] | null {
  const rows = COUNTRIES[(countryCode ?? '').toUpperCase()];
  if (!rows?.length) return null;
  return rows
    .filter((r) => /^\d{2,6}$/.test(r.number))
    .map((r) => ({ label: r.label, number: r.number, kind: KIND[r.kind] ?? 'other' }));
}
