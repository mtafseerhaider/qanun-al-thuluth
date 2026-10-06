import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';

import { AuthWelcomeScreen, LoginScreen, OtpVerifyScreen } from '@/features/auth';

import type { AuthStackParamList } from './types';

const Stack = createNativeStackNavigator<AuthStackParamList>();

export function AuthStack() {
  const { t } = useTranslation('auth');
  return (
    <Stack.Navigator>
      <Stack.Screen
        name="AuthWelcome"
        component={AuthWelcomeScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen name="Login" component={LoginScreen} options={{ title: t('login.title') }} />
      <Stack.Screen
        name="OtpVerify"
        component={OtpVerifyScreen}
        options={{ title: t('otp.title') }}
      />
    </Stack.Navigator>
  );
}
