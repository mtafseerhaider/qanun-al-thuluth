import { createNavigationContainerRef } from '@react-navigation/native';

import type { RootStackParamList } from './types';

/** For navigation outside components (push notification handlers, auth events). */
export const navigationRef = createNavigationContainerRef<RootStackParamList>();
