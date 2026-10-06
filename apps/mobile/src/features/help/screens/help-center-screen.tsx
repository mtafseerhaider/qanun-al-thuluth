import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { NavRow } from '@/features/exposures';
import { track } from '@/lib/analytics/track';
import type { MoreScreenProps } from '@/navigation/types';

import { HELP_CATEGORIES, helpContent } from '../content';
import { searchHelp } from '../utils/help-search';

/**
 * Help center (S6-12): 30 bundled articles in English and Urdu, searchable offline, grouped by
 * topic, with contact support and About at the end.
 */
export function HelpCenterScreen({ route, navigation }: MoreScreenProps<'HelpCenter'>) {
  const { t, i18n } = useTranslation('help');
  const content = helpContent(i18n.language);
  const [query, setQuery] = useState(route.params?.query ?? '');
  const results = useMemo(() => searchHelp(content.articles, query), [content, query]);
  const searching = query.trim().length >= 2;

  useEffect(() => {
    if (!searching) return;
    const id = setTimeout(
      () => track('help_search', { results: Math.min(100, results.length) }),
      800,
    );
    return () => clearTimeout(id);
  }, [query, results.length, searching]);

  const open = (slug: string) => navigation.navigate('HelpArticle', { slug });
  return (
    <Screen testID="help.screen">
      <Text variant="title" accessibilityRole="header">
        {t('center.title')}
      </Text>
      <Input
        label={t('center.search')}
        value={query}
        onChangeText={setQuery}
        variant="search"
        autoCorrect={false}
        testID="help.search"
      />
      {content.draft ? (
        <Text variant="caption" tone="muted" testID="help.draft">
          {t('center.draft')}
        </Text>
      ) : null}
      {searching ? (
        <View testID="help.results">
          <Text variant="label" tone="muted">
            {t('center.results', { count: results.length })}
          </Text>
          {results.map((a) => (
            <NavRow
              key={a.slug}
              label={a.title}
              onPress={() => open(a.slug)}
              testID={`help.result.${a.slug}`}
            />
          ))}
        </View>
      ) : (
        HELP_CATEGORIES.map((c) => (
          <View key={c} testID={`help.category.${c}`}>
            <Text variant="heading" accessibilityRole="header">
              {t(`categories.${c}`)}
            </Text>
            {content.articles
              .filter((a) => a.category === c)
              .map((a) => (
                <NavRow
                  key={a.slug}
                  label={a.title}
                  onPress={() => open(a.slug)}
                  testID={`help.article.${a.slug}`}
                />
              ))}
          </View>
        ))
      )}
      <View className="gap-2">
        <Button
          label={t('center.contact')}
          variant="secondary"
          onPress={() => navigation.navigate('ContactSupport')}
          testID="help.contact"
        />
        <Button
          label={t('center.about')}
          variant="ghost"
          onPress={() => navigation.navigate('About')}
          testID="help.about"
        />
      </View>
    </Screen>
  );
}
