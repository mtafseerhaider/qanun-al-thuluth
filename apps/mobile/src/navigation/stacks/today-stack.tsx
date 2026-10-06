import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { DashboardScreen } from '@/features/today';

import type { TodayStackParamList } from '../types';

const Stack = createNativeStackNavigator<TodayStackParamList>();

export function TodayStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="Dashboard" component={DashboardScreen} options={{ headerShown: false }} />
    </Stack.Navigator>
  );
}
