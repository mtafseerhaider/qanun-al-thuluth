import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import type { AcceptanceScore, MealStatus } from '@shared';

import type { DailyMealView, ServingView } from '../api/meals-api';
import { localized } from '../utils/meal-parsing';
import { portionLabel, showAcceptanceFor, type MemberLite } from '../utils/meal-rules';
import { MealServingRow } from './meal-serving-row';

/** Per-member serving rows of one planned meal (02 §7.5.3 region 6). Callbacks only. */
export function MealServingsEditor({
  meal,
  members,
  queuedIds,
  disabled,
  onStatus,
  onAcceptance,
  testID = 'servings',
}: {
  meal: DailyMealView;
  members: ReadonlyMap<string, MemberLite>;
  queuedIds: ReadonlySet<string>;
  disabled: boolean;
  onStatus: (serving: ServingView, member: MemberLite, status: MealStatus) => void;
  onAcceptance: (serving: ServingView, member: MemberLite, score: AcceptanceScore) => void;
  testID?: string;
}) {
  const { i18n } = useTranslation();
  return (
    <View className="gap-3" testID={testID}>
      {meal.servings.map((s, i) => {
        const member = members.get(s.familyMemberId);
        if (!member) return null;
        return (
          <MealServingRow
            key={s.id}
            member={member}
            portionLabel={portionLabel(s.portion, i18n.language)}
            adaptation={s.adaptation}
            adaptedMealTitle={
              s.adaptedMeal
                ? localized(s.adaptedMeal.titleI18n, i18n.language, s.adaptedMeal.title)
                : null
            }
            status={s.status}
            acceptance={s.acceptance}
            showAcceptance={showAcceptanceFor(member)}
            queued={queuedIds.has(s.id)}
            disabled={disabled}
            onStatusChange={(status) => onStatus(s, member, status)}
            onAcceptanceChange={(score) => onAcceptance(s, member, score)}
            testID={`${testID}.row-${i}`}
          />
        );
      })}
    </View>
  );
}
