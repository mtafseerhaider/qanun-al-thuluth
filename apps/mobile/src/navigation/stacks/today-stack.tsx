import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';

import { MealDetailScreen } from '@/features/meals';
import { NotificationsCenterScreen } from '@/features/notifications';
import { RecipeDetailScreen } from '@/features/recipes';
import { DashboardScreen } from '@/features/today';
import { DailyReflectionScreen } from '@/features/tracking';

import type { TodayStackParamList } from '../types';
import { useStackMotion } from '../motion';

const Stack = createNativeStackNavigator<TodayStackParamList>();

export function TodayStack() {
  const motion = useStackMotion();
  const { t } = useTranslation('navigation');
  return (
    <Stack.Navigator screenOptions={motion}>
      <Stack.Screen
        name="Dashboard"
        getComponent={() => DashboardScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="MealDetail"
        getComponent={() => MealDetailScreen}
        options={{ title: t('screens.mealDetail') }}
      />
      <Stack.Screen
        name="RecipeDetail"
        getComponent={() => RecipeDetailScreen}
        options={{ title: t('screens.recipeDetail') }}
      />
      <Stack.Screen
        name="NotificationsCenter"
        getComponent={() => NotificationsCenterScreen}
        options={{ title: t('screens.notificationsCenter') }}
      />
      <Stack.Screen
        name="DailyReflection"
        getComponent={() => DailyReflectionScreen}
        options={{ title: t('screens.dailyReflection') }}
      />
    </Stack.Navigator>
  );
}
