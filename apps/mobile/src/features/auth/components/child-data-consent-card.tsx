import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { InlineMessage } from '@/components/ui/inline-message';
import { Text } from '@/components/ui/text';
import { errorKeyFor } from '@/lib/supabase/error-mapping';

import { useChildDataConsent } from '../hooks/use-consents';

/**
 * `ConsentInlineCard` for child data (11 §13.2, 02 §7.3.2): shown before the first member under 18
 * is saved in a household. Explains what is stored, why, who sees it and how to delete it, then
 * writes `consents(kind = 'child_data', household_id)` with the current version.
 */
export function ChildDataConsentCard({
  householdId,
  testID = 'consent.child-data',
}: {
  householdId: string;
  testID?: string;
}) {
  const { t } = useTranslation(['onboarding', 'errors']);
  const { granted, granting, error, grant } = useChildDataConsent(householdId);
  const [checked, setChecked] = useState(false);
  if (granted) return null;

  return (
    <Card variant="outlined" testID={testID}>
      <Text variant="heading" accessibilityRole="header">
        {t('onboarding:childConsent.title')}
      </Text>
      <Text tone="muted">{t('onboarding:childConsent.body')}</Text>
      <Checkbox
        label={t('onboarding:childConsent.agree')}
        checked={checked}
        onChange={setChecked}
        testID={`${testID}.checkbox`}
      />
      {error ? <InlineMessage tone="danger" message={t(`errors:${errorKeyFor(error)}`)} /> : null}
      <Button
        label={t('onboarding:childConsent.confirm')}
        disabled={!checked}
        loading={granting}
        onPress={() => void grant().catch(() => undefined)}
        testID={`${testID}.confirm`}
      />
    </Card>
  );
}
