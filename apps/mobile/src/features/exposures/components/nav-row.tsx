import { Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';

/** A full-width 48 pt row that opens another screen (link role, chevron flips in RTL by layout). */
export function NavRow({
  label,
  hint,
  badge,
  onPress,
  testID,
}: {
  label: string;
  hint?: string;
  badge?: string;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[label, badge, hint].filter(Boolean).join(', ')}
      onPress={onPress}
      className="min-h-control flex-row items-center justify-between gap-3 border-b border-line py-2"
      testID={testID}
    >
      <View className="flex-1 gap-0.5">
        <Text variant="bodyStrong">{label}</Text>
        {hint ? (
          <Text variant="caption" tone="muted">
            {hint}
          </Text>
        ) : null}
      </View>
      {badge ? (
        <Text variant="caption" tone="primary">
          {badge}
        </Text>
      ) : null}
    </Pressable>
  );
}
