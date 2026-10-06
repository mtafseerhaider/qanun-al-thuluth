import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';

import { ChatSessionsScreen, ChatThreadScreen } from '@/features/chat';

import type { ChatStackParamList } from '../types';

const Stack = createNativeStackNavigator<ChatStackParamList>();

/** The thread is the tab's first screen (02 §7.7); past conversations open from its header. */
export function ChatStack() {
  const { t } = useTranslation('navigation');
  return (
    <Stack.Navigator initialRouteName="ChatThread">
      <Stack.Screen
        name="ChatThread"
        component={ChatThreadScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="ChatSessions"
        component={ChatSessionsScreen}
        options={{ title: t('screens.chatSessions') }}
      />
    </Stack.Navigator>
  );
}
