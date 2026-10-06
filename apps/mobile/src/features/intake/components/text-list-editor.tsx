import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/** Free-text "add" row: an input and an Add button. Calls `onAdd` with the trimmed text. */
export function AddTextRow({
  label,
  helper,
  onAdd,
  maxLength = 120,
  testID,
}: {
  label: string;
  helper?: string;
  onAdd: (text: string) => void;
  maxLength?: number;
  testID: string;
}) {
  const { t } = useTranslation('intake');
  const [text, setText] = useState('');
  const add = () => {
    const v = text.trim();
    if (!v) return;
    onAdd(v);
    setText('');
  };
  return (
    <View className="gap-2">
      <Input
        label={label}
        {...(helper ? { helperText: helper } : {})}
        value={text}
        onChangeText={setText}
        maxLength={maxLength}
        onSubmitEditing={add}
        returnKeyType="done"
        testID={`${testID}.input`}
      />
      <Button
        label={t('common.add')}
        variant="secondary"
        size="sm"
        className="self-start"
        disabled={text.trim() === ''}
        onPress={add}
        testID={`${testID}.add`}
      />
    </View>
  );
}
