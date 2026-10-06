import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';

import { GroceryListDetailScreen, GroceryListsScreen } from '@/features/grocery';
import { MealDetailScreen } from '@/features/meals';
import { MealPlanDetailScreen, MealPlansScreen } from '@/features/plan';
import { RecipeDetailScreen } from '@/features/recipes';

import type { PlanStackParamList } from '../types';
import { useStackMotion } from '../motion';

const Stack = createNativeStackNavigator<PlanStackParamList>();

export function PlanStack() {
  const motion = useStackMotion();
  const { t } = useTranslation('navigation');
  return (
    <Stack.Navigator screenOptions={motion}>
      <Stack.Screen
        name="MealPlans"
        getComponent={() => MealPlansScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="MealPlanDetail"
        getComponent={() => MealPlanDetailScreen}
        options={{ title: t('screens.mealPlanDetail') }}
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
        name="GroceryLists"
        getComponent={() => GroceryListsScreen}
        options={{ title: t('screens.groceryLists') }}
      />
      <Stack.Screen
        name="GroceryListDetail"
        getComponent={() => GroceryListDetailScreen}
        options={{ title: t('screens.groceryListDetail') }}
      />
    </Stack.Navigator>
  );
}
