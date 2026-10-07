import { useQuery, useQueryClient } from '@tanstack/react-query';
import Constants from 'expo-constants';
import { useEffect, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';

import { useFeatureFlag } from '@/hooks/use-feature-flag';
import {
  isBelowMinimum,
  storeUrls,
  type MinSupportedVersion,
  type StorePlatform,
} from '@/lib/app-status/app-version';
import { env } from '@/lib/env';
import { fetchMinSupportedVersion } from '@/lib/feature-flags/feature-flags-api';
import { qk } from '@/lib/query/query-keys';
import { useAppStatusStore } from '@/stores/use-app-status-store';
import { useSessionStore } from '@/stores/use-session-store';

import { MaintenanceScreen } from './screens/maintenance-screen';
import { UpdateRequiredScreen } from './screens/update-required-screen';

export type AppStatus = 'ok' | 'maintenance' | 'update_required';

/** Update required wins over maintenance: an unsupported build must update either way. */
export function resolveAppStatus(input: {
  installedVersion: string;
  platform: StorePlatform;
  minVersion: MinSupportedVersion | null;
  upgradeRequiredByServer: boolean;
  maintenanceFlag: boolean;
  maintenanceByServer: boolean;
}): AppStatus {
  if (
    input.upgradeRequiredByServer ||
    isBelowMinimum(input.installedVersion, input.minVersion, input.platform)
  )
    return 'update_required';
  if (input.maintenanceFlag || input.maintenanceByServer) return 'maintenance';
  return 'ok';
}

const PLATFORM: StorePlatform = Platform.OS === 'ios' ? 'ios' : 'android';
const PACKAGE_ID = Constants.expoConfig?.android?.package ?? 'app.thuluth.mobile';

/**
 * Root gate for the blocking interstitials (02 §7.1.1). The installed version is the app config
 * `version` (env.APP_VERSION): with the fingerprint runtime policy an update only reaches binaries
 * built from the same config, so it is the store version of the running binary. Flags are read only
 * when signed in; missing, offline or unreadable flags never block (safe default: run normally).
 */
export function AppStatusGate({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const userId = useSessionStore((s) => s.userId);
  const maintenanceFlag = useFeatureFlag('app.maintenance');
  const maintenanceByServer = useAppStatusStore((s) => s.maintenance);
  const upgradeRequiredByServer = useAppStatusStore((s) => s.upgradeRequired);
  const clearMaintenance = useAppStatusStore((s) => s.clearMaintenance);
  const [retrying, setRetrying] = useState(false);

  const minVersion = useQuery({
    queryKey: qk.minSupportedVersion(userId),
    queryFn: fetchMinSupportedVersion,
    enabled: userId !== null,
    staleTime: 5 * 60_000,
  });

  // The flags query is not user-scoped; re-evaluate once a user signs in.
  useEffect(() => {
    if (userId) void queryClient.invalidateQueries({ queryKey: qk.featureFlags(), exact: true });
  }, [queryClient, userId]);

  const status = resolveAppStatus({
    installedVersion: env.APP_VERSION,
    platform: PLATFORM,
    minVersion: minVersion.data ?? null,
    upgradeRequiredByServer,
    maintenanceFlag,
    maintenanceByServer,
  });

  if (status === 'update_required')
    return (
      <UpdateRequiredScreen storeUrls={storeUrls(PLATFORM, PACKAGE_ID, minVersion.data ?? null)} />
    );
  if (status === 'maintenance')
    return (
      <MaintenanceScreen
        retrying={retrying}
        onRetry={() => {
          setRetrying(true);
          clearMaintenance();
          void queryClient
            .refetchQueries({ queryKey: qk.featureFlags() })
            .finally(() => setRetrying(false));
        }}
      />
    );
  return children;
}
