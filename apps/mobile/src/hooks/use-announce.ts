import { useEffect, useRef } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * Announces `message` to VoiceOver / TalkBack when `key` changes after the first render (24 S7-04,
 * a11y-audit gap 1): status that changes while a screen is open, such as an export becoming
 * ready or a deletion being scheduled. The first value is not announced; it is read with the
 * screen. A null key or message announces nothing.
 */
export function useAnnounceOnChange(key: string | null, message: string | null): void {
  const previous = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const before = previous.current;
    previous.current = key;
    if (before === undefined || key === before || key === null || !message) return;
    AccessibilityInfo.announceForAccessibility(message);
  }, [key, message]);
}

/** Keys of rows whose status moved into one of `announce` since the last render. */
export function changedInto<S extends string>(
  previous: ReadonlyMap<string, S>,
  next: ReadonlyMap<string, S>,
  announce: readonly S[],
): string[] {
  const out: string[] = [];
  for (const [id, status] of next) {
    const before = previous.get(id);
    if (before !== undefined && before !== status && announce.includes(status)) out.push(id);
  }
  return out;
}
