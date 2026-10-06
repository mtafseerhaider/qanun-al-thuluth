import { useEffect, useState } from 'react';

import { useIntakeDraftStore } from '../store/use-intake-draft-store';

/** True once the encrypted intake draft has been read back, so resume decisions see saved answers. */
export function useIntakeHydrated(): boolean {
  const [hydrated, setHydrated] = useState(() => useIntakeDraftStore.persist.hasHydrated());
  useEffect(() => {
    const unsubscribe = useIntakeDraftStore.persist.onFinishHydration(() => setHydrated(true));
    setHydrated(useIntakeDraftStore.persist.hasHydrated());
    return unsubscribe;
  }, []);
  return hydrated;
}
