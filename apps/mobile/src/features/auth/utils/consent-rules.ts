import { CONSENT_VERSIONS, REQUIRED_CONSENTS, type ConsentKind } from '@shared';

/** A non-withdrawn `consents` row as the client reads it. */
export interface LiveConsent {
  kind: string;
  version: string;
  household_id: string | null;
  granted_at?: string;
}

export function hasCurrentConsent(
  live: readonly LiveConsent[],
  kind: ConsentKind,
  householdId: string | null = null,
  versions: Record<ConsentKind, string> = CONSENT_VERSIONS,
): boolean {
  return live.some(
    (c) =>
      c.kind === kind &&
      c.version === versions[kind] &&
      (householdId === null || c.household_id === householdId),
  );
}

/** Required kinds (FR-AUTH-05) without a live grant of the current version. */
export function missingRequiredConsents(
  live: readonly LiveConsent[],
  versions: Record<ConsentKind, string> = CONSENT_VERSIONS,
): ConsentKind[] {
  return REQUIRED_CONSENTS.filter((k) => !hasCurrentConsent(live, k, null, versions));
}

/** Continue is enabled only when every required box is ticked (or already granted). */
export function canContinueWithConsents(
  checked: Partial<Record<ConsentKind, boolean>>,
  live: readonly LiveConsent[] = [],
): boolean {
  return REQUIRED_CONSENTS.every((k) => checked[k] === true || hasCurrentConsent(live, k));
}

/**
 * The child-data consent gate (11 §13.2): needed before saving a member under 18 when the user has
 * no current `child_data` grant for this household.
 */
export function needsChildDataConsent(
  memberIsMinor: boolean,
  live: readonly LiveConsent[],
  householdId: string,
): boolean {
  return memberIsMinor && !hasCurrentConsent(live, 'child_data', householdId);
}
