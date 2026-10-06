import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';

import type { IngredientLite } from '../api/exposures-api';
import { useIngredientSearch } from '../hooks/use-exposures';

/**
 * Catalog food search (picky and autism modules). Exposures need an ingredient id, so the parent
 * picks from the catalog; results are 48 pt rows with a button role.
 */
export function IngredientPicker({
  label,
  selected,
  onSelect,
  testID = 'ingredient-picker',
}: {
  label: string;
  selected: IngredientLite | null;
  onSelect: (ingredient: IngredientLite | null) => void;
  testID?: string;
}) {
  const { t } = useTranslation('picky');
  const [query, setQuery] = useState('');
  const search = useIngredientSearch(selected ? '' : query);

  if (selected)
    return (
      <View className="flex-row items-center justify-between gap-2" testID={`${testID}.selected`}>
        <Text variant="bodyStrong">{selected.label}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('picker.changeA11y', { food: selected.label })}
          onPress={() => {
            onSelect(null);
            setQuery('');
          }}
          className="min-h-control justify-center px-3"
          testID={`${testID}.change`}
        >
          <Text tone="primary">{t('picker.change')}</Text>
        </Pressable>
      </View>
    );

  const results = search.data ?? [];
  return (
    <View className="gap-1" testID={testID}>
      <Input
        label={label}
        value={query}
        onChangeText={setQuery}
        variant="search"
        helperText={t('picker.hint')}
        autoCorrect={false}
        testID={`${testID}.query`}
      />
      {query.trim().length >= 2 && !search.isFetching && results.length === 0 ? (
        <Text tone="muted">{t('picker.none')}</Text>
      ) : null}
      {results.map((r) => (
        <Pressable
          key={r.id}
          accessibilityRole="button"
          accessibilityLabel={r.label}
          onPress={() => onSelect(r)}
          className="min-h-control justify-center border-b border-line px-1"
          testID={`${testID}.result`}
        >
          <Text>{r.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}
