import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';

import { GroceryListDetailScreen, GroceryListsScreen } from '@/features/grocery';
import { MealDetailScreen } from '@/features/meals';
import { MealPlanDetailScreen, MealPlansScreen } from '@/features/plan';
import { RecipeDetailScreen } from '@/features/recipes';

import type { PlanStackParamList } from '../types';

const Stack = createNativeStackNavigator<PlanStackParamList>();

export function PlanStack() {
  const { t } = useTranslation('navigation');
  return (
    <Stack.Navigator>
      <Stack.Screen name="MealPlans" component={MealPlansScreen} options={{ headerShown: false }} />
      <Stack.Screen
        name="MealPlanDetail"
        component={MealPlanDetailScreen}
        options={{ title: t('screens.mealPlanDetail') }}
      />
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
      <Stack.Screen
        name="GroceryLists"
        component={GroceryListsScreen}
        options={{ title: t('screens.groceryLists') }}
      />
      <Stack.Screen
        name="GroceryListDetail"
        component={GroceryListDetailScreen}
        options={{ title: t('screens.groceryListDetail') }}
      />
    </Stack.Navigator>
  );
}
