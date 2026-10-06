import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';

export const UNDO_WINDOW_MS = 5_000;

/** Undo offer after a bulk log (02 §5.5: "Toast with Undo 5 s"); a toast primitive arrives later. */
export function useUndo(windowMs = UNDO_WINDOW_MS) {
  const [pending, setPending] = useState<{ message: string; undo: () => void } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setPending(null);
  }, []);
  const offer = useCallback(
    (message: string, undo: () => void) => {
      if (timer.current) clearTimeout(timer.current);
      setPending({ message, undo });
      timer.current = setTimeout(() => setPending(null), windowMs);
    },
    [windowMs],
  );
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  return { pending, offer, clear };
}

export function UndoBar({
  pending,
  onUndo,
  testID = 'undo-bar',
}: {
  pending: { message: string } | null;
  onUndo: () => void;
  testID?: string;
}) {
  const { t } = useTranslation('meals');
  if (!pending) return null;
  return (
    <View
      accessibilityLiveRegion="polite"
      className="flex-row items-center justify-between gap-3 rounded-md bg-surface-sunken p-3"
      testID={testID}
    >
      <Text variant="caption" className="flex-1">
        {pending.message}
      </Text>
      <Button
        label={t('undo')}
        size="sm"
        variant="ghost"
        onPress={onUndo}
        testID={`${testID}.undo`}
      />
    </View>
  );
}
