import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking } from 'react-native';

import { Button } from '@/components/ui/button';
import { InlineMessage } from '@/components/ui/inline-message';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';

/** Opens the first store link that works (the flag's override, the store app, the store website). */
export async function openFirstUrl(
  urls: readonly string[],
  open: (url: string) => Promise<unknown> = (url) => Linking.openURL(url),
): Promise<boolean> {
  for (const url of urls) {
    try {
      await open(url);
      return true;
    } catch {
      // try the next link
    }
  }
  return false;
}

/**
 * Blocking "Update required" interstitial (02 §2 and §7.1.1, 06 UPGRADE_REQUIRED): the installed
 * version is below `app.min_supported_version`. There is no way past it except the store.
 */
export function UpdateRequiredScreen({ storeUrls }: { storeUrls: readonly string[] }) {
  const { t } = useTranslation('common');
  const [failed, setFailed] = useState(false);
  return (
    <Screen
      title={t('appStatus.updateRequired.title')}
      edges={['top', 'bottom']}
      testID="app-status.update-required.screen"
    >
      <Text>{t('appStatus.updateRequired.body')}</Text>
      {failed ? (
        <InlineMessage tone="warning" message={t('appStatus.updateRequired.openFailed')} />
      ) : null}
      <Button
        label={t('appStatus.updateRequired.action')}
        fullWidth
        onPress={() => void openFirstUrl(storeUrls).then((ok) => setFailed(!ok))}
        testID="app-status.update-required.open-store"
      />
    </Screen>
  );
}
