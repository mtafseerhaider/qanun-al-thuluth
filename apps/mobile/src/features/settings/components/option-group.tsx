import { View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';

export interface Option<T extends string> {
  value: T;
  label: string;
}

/** Simple single-select row of buttons until the SegmentedControl primitive lands (08 §4.13). */
export function OptionGroup<T extends string>({
  label,
  hint,
  options,
  value,
  onChange,
  testID,
}: {
  label: string;
  hint?: string;
  options: readonly Option<T>[];
  value: T;
  onChange: (value: T) => void;
  testID: string;
}) {
  return (
    <View
      className="gap-2"
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      testID={testID}
    >
      <Text variant="heading">{label}</Text>
      {hint ? (
        <Text variant="caption" tone="muted">
          {hint}
        </Text>
      ) : null}
      <View className="flex-row flex-wrap gap-2">
        {options.map((o) => (
          <Button
            key={o.value}
            label={o.label}
            size="sm"
            variant={o.value === value ? 'primary' : 'secondary'}
            accessibilityRole="radio"
            onPress={() => onChange(o.value)}
            testID={`${testID}.${o.value}`}
          />
        ))}
      </View>
    </View>
  );
}
