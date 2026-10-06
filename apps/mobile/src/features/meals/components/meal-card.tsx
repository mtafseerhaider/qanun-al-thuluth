import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import type { MealStatus, MealType } from '@shared';

import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { formatTime } from '@/lib/dates/local-date';
import { cn } from '@/theme/cn';

import { Badge, PlateMini, QueuedBadge, StatusGlyph } from './meal-badges';

export interface MealCardServing {
  memberId: string;
  name: string;
  status: MealStatus;
  adapted: boolean;
  queued: boolean;
}

export type MealCardTag = 'kid_friendly' | 'autism_friendly' | 'sunnah_food' | 'swapped';

/**
 * Planned meal card (08 §5.5, 03 §10.4). Pure: data and callbacks come from the screen. The `cell`
 * density is the compact layout inside the week grid (title and adaptation dot only). Children's
 * numbers never appear here: the card has no portions at all.
 */
export function MealCard({
  mealType,
  title,
  scheduledTime,
  plateSplit,
  servings,
  tags = [],
  density = 'default',
  current = false,
  onPress,
  onEveryoneAte,
  onSwap,
  testID,
}: {
  mealType: MealType;
  title: string;
  scheduledTime?: string | null;
  plateSplit?: { veg_fruit: number; protein: number; carb: number } | null;
  servings: MealCardServing[];
  tags?: MealCardTag[];
  density?: 'default' | 'cell';
  current?: boolean;
  onPress: () => void;
  onEveryoneAte?: (() => void) | undefined;
  onSwap?: (() => void) | undefined;
  testID: string;
}) {
  const { t } = useTranslation('meals');
  const time = formatTime(scheduledTime);
  const logged = servings.filter((s) => s.status !== 'planned').length;
  const allLogged = servings.length > 0 && logged === servings.length;
  const anyQueued = servings.some((s) => s.queued);
  const adapted = servings.some((s) => s.adapted);
  const typeLabel = t(`mealType.${mealType}`);

  if (density === 'cell') {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={t('card.cellA11y', { type: typeLabel, title })}
        className="min-h-control gap-1 rounded-md border border-line bg-surface-raised p-2"
        testID={testID}
      >
        <Text variant="caption" numberOfLines={2}>
          {title}
        </Text>
        {adapted ? (
          <View className="h-2 w-2 rounded-full bg-info" testID={`${testID}.adapted`} />
        ) : null}
      </Pressable>
    );
  }

  return (
    <View
      className={cn(
        'gap-3 rounded-lg border bg-surface-raised p-4',
        current ? 'border-2 border-primary' : 'border-line',
      )}
      testID={testID}
    >
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={t('card.a11y', {
          type: typeLabel,
          title,
          logged,
          total: servings.length,
        })}
        className="flex-row items-start gap-3"
        testID={`${testID}.open`}
      >
        {plateSplit ? <PlateMini split={plateSplit} /> : null}
        <View className="flex-1 gap-1">
          <View className="flex-row flex-wrap items-center gap-2">
            <Text variant="overline" tone="muted">
              {typeLabel}
            </Text>
            {time ? (
              <Text variant="caption" tone="muted">
                {time}
              </Text>
            ) : null}
          </View>
          <Text variant="heading" tone={allLogged ? 'muted' : 'neutral'} numberOfLines={2}>
            {title}
          </Text>
          {tags.length > 0 ? (
            <View className="flex-row flex-wrap gap-1">
              {tags.slice(0, 2).map((tag) => (
                <Badge key={tag} label={t(`tags.${tag}`)} testID={`${testID}.tag.${tag}`} />
              ))}
            </View>
          ) : null}
        </View>
      </Pressable>
      {servings.length > 0 ? (
        <View className="flex-row flex-wrap gap-3" testID={`${testID}.servings`}>
          {servings.map((s) => (
            <StatusGlyph key={s.memberId} status={s.status} name={s.name} />
          ))}
        </View>
      ) : null}
      <View className="flex-row flex-wrap items-center gap-2">
        <Text variant="caption" tone="muted" testID={`${testID}.progress`}>
          {allLogged ? t('card.allLogged') : t('card.logged', { logged, total: servings.length })}
        </Text>
        {anyQueued ? <QueuedBadge testID={`${testID}.queued`} /> : null}
      </View>
      {(onEveryoneAte && !allLogged) || onSwap ? (
        <View className="flex-row flex-wrap gap-2">
          {onEveryoneAte && !allLogged ? (
            <Button
              label={t('card.everyoneAte')}
              size="sm"
              onPress={onEveryoneAte}
              testID={`${testID}.everyone-ate`}
            />
          ) : null}
          {onSwap ? (
            <Button
              label={t('card.swap')}
              size="sm"
              variant="secondary"
              onPress={onSwap}
              testID={`${testID}.swap`}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
