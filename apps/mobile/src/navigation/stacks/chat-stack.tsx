import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';

import { ChatSessionsScreen, ChatThreadScreen } from '@/features/chat';

import type { ChatStackParamList } from '../types';
import { useStackMotion } from '../motion';

const Stack = createNativeStackNavigator<ChatStackParamList>();

/** The thread is the tab's first screen (02 §7.7); past conversations open from its header. */
export function ChatStack() {
  const motion = useStackMotion();
  const { t } = useTranslation('navigation');
  return (
    <Stack.Navigator initialRouteName="ChatThread" screenOptions={motion}>
      <Stack.Screen
        name="ChatThread"
        getComponent={() => ChatThreadScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="ChatSessions"
        getComponent={() => ChatSessionsScreen}
        options={{ title: t('screens.chatSessions') }}
      />
    </Stack.Navigator>
  );
}
