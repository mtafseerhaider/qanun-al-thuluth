import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';

import { MealDetailScreen } from '@/features/meals';
import { RecipeDetailScreen } from '@/features/recipes';
import { DashboardScreen } from '@/features/today';

import type { TodayStackParamList } from '../types';

const Stack = createNativeStackNavigator<TodayStackParamList>();

export function TodayStack() {
  const { t } = useTranslation('navigation');
  return (
    <Stack.Navigator>
      <Stack.Screen name="Dashboard" component={DashboardScreen} options={{ headerShown: false }} />
      <Stack.Screen
        name="MealDetail"
        component={MealDetailScreen}
        options={{ title: t('screens.mealDetail') }}
      />
      <Stack.Screen
        name="RecipeDetail"
        component={RecipeDetailScreen}
        options={{ title: t('screens.recipeDetail') }}
      />
    </Stack.Navigator>
  );
}
