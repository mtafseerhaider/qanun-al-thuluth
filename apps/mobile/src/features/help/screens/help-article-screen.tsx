import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { track } from '@/lib/analytics/track';
import type { MoreScreenProps } from '@/navigation/types';

import { findArticle } from '../content';

/** One help article with a "Was this helpful?" question (S6-12). */
export function HelpArticleScreen({ route, navigation }: MoreScreenProps<'HelpArticle'>) {
  const { slug } = route.params;
  const { t, i18n } = useTranslation('help');
  const found = findArticle(i18n.language, slug);
  const [answered, setAnswered] = useState(false);

  useEffect(() => {
    if (found && /^[a-z0-9-]+$/.test(slug)) track('help_article_viewed', { slug });
  }, [slug, found]);

  if (!found)
    return (
      <Screen testID="help-article.screen">
        <Text tone="muted">{t('article.missing')}</Text>
        <Button label={t('article.back')} onPress={() => navigation.navigate('HelpCenter', {})} />
      </Screen>
    );

  const { article, draft } = found;
  const feedback = (helpful: boolean) => {
    track('help_article_feedback', { slug, helpful });
    setAnswered(true);
  };
  return (
    <Screen testID="help-article.screen">
      <Text variant="title" accessibilityRole="header">
        {article.title}
      </Text>
      {draft ? (
        <Text variant="caption" tone="muted">
          {t('center.draft')}
        </Text>
      ) : null}
      <View className="gap-3">
        {article.body.map((p, i) =>
          p.startsWith('• ') ? (
            <Text key={i} className="ps-2">
              {p}
            </Text>
          ) : (
            <Text key={i}>{p}</Text>
          ),
        )}
      </View>
      <View className="gap-2 border-t border-line pt-3" testID="help-article.feedback">
        {answered ? (
          <Text tone="muted" testID="help-article.thanks">
            {t('article.thanks')}
          </Text>
        ) : (
          <>
            <Text variant="bodyStrong">{t('article.helpful')}</Text>
            <View className="flex-row gap-2">
              <Button
                label={t('article.yes')}
                size="sm"
                variant="secondary"
                onPress={() => feedback(true)}
                testID="help-article.yes"
              />
              <Button
                label={t('article.no')}
                size="sm"
                variant="secondary"
                onPress={() => feedback(false)}
                testID="help-article.no"
              />
            </View>
          </>
        )}
        <Button
          label={t('center.contact')}
          variant="ghost"
          onPress={() => navigation.navigate('ContactSupport')}
          testID="help-article.contact"
        />
      </View>
    </Screen>
  );
}
