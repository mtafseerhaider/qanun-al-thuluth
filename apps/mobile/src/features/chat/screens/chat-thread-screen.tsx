import { useTranslation } from 'react-i18next';

import { PlaceholderScreen } from '@/components/layout/placeholder-screen';

/** Sprint 0 placeholder for `ChatThread` (02 §3.2). */
export function ChatThreadScreen() {
  const { t } = useTranslation(['navigation', 'common']);
  return (
    <PlaceholderScreen
      title={t('navigation:screens.chatThread')}
      body={t('common:comingSoon')}
      testID="chat-thread.screen"
    />
  );
}
