import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { MealPlansScreen } from '@/features/plan';

import type { PlanStackParamList } from '../types';

const Stack = createNativeStackNavigator<PlanStackParamList>();

export function PlanStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="MealPlans" component={MealPlansScreen} options={{ headerShown: false }} />
    </Stack.Navigator>
  );
}
