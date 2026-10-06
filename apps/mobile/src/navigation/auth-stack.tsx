import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';

import { AuthWelcomeScreen, LoginScreen, OtpVerifyScreen } from '@/features/auth';

import type { AuthStackParamList } from './types';
import { useStackMotion } from './motion';

const Stack = createNativeStackNavigator<AuthStackParamList>();

export function AuthStack() {
  const motion = useStackMotion();
  const { t } = useTranslation('auth');
  return (
    <Stack.Navigator screenOptions={motion}>
      <Stack.Screen
        name="AuthWelcome"
        getComponent={() => AuthWelcomeScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="Login"
        getComponent={() => LoginScreen}
        options={{ title: t('login.title') }}
      />
      <Stack.Screen
        name="OtpVerify"
        getComponent={() => OtpVerifyScreen}
        options={{ title: t('otp.title') }}
      />
    </Stack.Navigator>
  );
}
