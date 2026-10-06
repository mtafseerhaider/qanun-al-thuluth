/**
 * Crisis and red-flag rendering (FR-CHAT-10, 00 §10, 02 §7.13.4). Emergency numbers are bundled so
 * they show offline and before anything else in the answer. The country comes from the household.
 */
export interface EmergencyNumber {
  /** Copy key under `chat:safety.service.*`. */
  service: 'emergency' | 'rescue' | 'police' | 'ambulance' | 'nonEmergency' | 'health';
  number: string;
}

const NUMBERS: Record<string, readonly EmergencyNumber[]> = {
  PK: [
    { service: 'rescue', number: '1122' },
    { service: 'ambulance', number: '115' },
  ],
  GB: [
    { service: 'emergency', number: '999' },
    { service: 'nonEmergency', number: '111' },
  ],
  US: [{ service: 'emergency', number: '911' }],
  CA: [{ service: 'emergency', number: '911' }],
  AE: [
    { service: 'ambulance', number: '998' },
    { service: 'police', number: '999' },
  ],
  SA: [{ service: 'ambulance', number: '997' }],
};

/** Numbers for a country; unknown countries get a generic "local emergency services" line only. */
export function emergencyNumbersFor(
  countryCode: string | null | undefined,
): readonly EmergencyNumber[] {
  return NUMBERS[(countryCode ?? '').toUpperCase()] ?? [];
}

/** Recommendations that warrant the emergency block at the top of the answer. */
export function isUrgent(recommend: string | null | undefined): boolean {
  return recommend === 'emergency' || recommend === 'urgent_care';
}

export function telUrl(number: string): string {
  return `tel:${number.replace(/[^\d+]/g, '')}`;
}
