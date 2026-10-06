import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { ChatThreadScreen } from '@/features/chat';

import type { ChatStackParamList } from '../types';

const Stack = createNativeStackNavigator<ChatStackParamList>();

export function ChatStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen
        name="ChatThread"
        component={ChatThreadScreen}
        options={{ headerShown: false }}
      />
    </Stack.Navigator>
  );
}
