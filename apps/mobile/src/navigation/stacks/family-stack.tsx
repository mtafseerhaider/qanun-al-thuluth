import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { FamilyManagementScreen } from '@/features/family';

import type { FamilyStackParamList } from '../types';

const Stack = createNativeStackNavigator<FamilyStackParamList>();

export function FamilyStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen
        name="FamilyManagement"
        component={FamilyManagementScreen}
        options={{ headerShown: false }}
      />
    </Stack.Navigator>
  );
}
