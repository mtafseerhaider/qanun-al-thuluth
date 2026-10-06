import { useTranslation } from 'react-i18next';

import { InlineMessage } from '@/components/ui/inline-message';
import { useSessionStore } from '@/stores/use-session-store';

/** Shown on auth screens while an invitation token is parked (11 §12.3). */
export function InviteBanner() {
  const { t } = useTranslation('auth');
  const pending = useSessionStore((s) => s.pendingInviteToken);
  if (!pending) return null;
  return (
    <InlineMessage
      tone="info"
      title={t('invite.bannerTitle')}
      message={t('invite.bannerBody')}
      testID="auth.invite-banner"
    />
  );
}
