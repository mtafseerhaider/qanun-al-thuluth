import { useTranslation } from 'react-i18next';

import { Card } from '@/components/ui/card';
import { InlineMessage } from '@/components/ui/inline-message';
import { Text } from '@/components/ui/text';

import type { FastingEligibility, SafetyReason } from '../utils/fasting-rules';

/** Clinician card (FR-FAST-07): no fasting logs for this member; see a clinician first. */
export function ClinicianCard({
  reasons,
  name,
  testID = 'fasting.clinician-card',
}: {
  reasons: readonly SafetyReason[];
  name: string;
  testID?: string;
}) {
  const { t } = useTranslation('fasting');
  return (
    <Card variant="outlined" testID={testID}>
      <InlineMessage
        tone="warning"
        title={t('safety.title', { name })}
        message={t('safety.body')}
      />
      {reasons.map((r) => (
        <Text key={r} variant="caption" tone="muted" testID={`${testID}.${r}`}>
          {t(`safety.reason.${r}`)}
        </Text>
      ))}
      <Text variant="caption" tone="muted">
        {t('safety.footer')}
      </Text>
    </Card>
  );
}

/** Explains the member's fasting options (under 7, practice, pregnancy and breastfeeding). */
export function EligibilityNotice({
  eligibility,
  name,
}: {
  eligibility: FastingEligibility;
  name: string;
}) {
  const { t } = useTranslation('fasting');
  if (eligibility.mode === 'blocked')
    return <ClinicianCard reasons={eligibility.reasons} name={name} />;
  if (eligibility.mode === 'under_7')
    return (
      <Card variant="filled" testID="fasting.under-7">
        <Text variant="bodyStrong">{t('child.under7Title', { name })}</Text>
        <Text>{t('child.under7Body')}</Text>
      </Card>
    );
  if (eligibility.mode === 'practice')
    return (
      <Card variant="filled" testID="fasting.practice">
        <Text variant="bodyStrong">{t('child.practiceTitle', { name })}</Text>
        <Text>{t('child.practiceBody')}</Text>
        <Text variant="caption" tone="muted">
          {t('child.stopRules')}
        </Text>
      </Card>
    );
  if (eligibility.decideWithClinician)
    return (
      <Card variant="filled" testID="fasting.decide-with-clinician">
        <Text variant="bodyStrong">{t('pregnancy.title')}</Text>
        <Text>{t('pregnancy.body')}</Text>
      </Card>
    );
  return null;
}
