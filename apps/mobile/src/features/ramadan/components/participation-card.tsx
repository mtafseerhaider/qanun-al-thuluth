import { useTranslation } from 'react-i18next';

import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { ChipGroup } from '@/components/ui/chip';
import { InlineMessage } from '@/components/ui/inline-message';
import { RadioCardGroup } from '@/components/ui/radio-card-group';
import { Text } from '@/components/ui/text';

import {
  PRACTICE_UNTIL,
  SETUP_EXEMPTION_REASONS,
  validateChoice,
  withIntention,
  type ExemptionReason,
  type Intention,
  type ParticipationChoice,
  type ParticipationRule,
  type PracticeUntil,
} from '../utils/ramadan-rules';

const PRACTICE_DAYS = ['1', '2', '3', '4', '5', '6', '7'] as const;

/** One member's Ramadan participation (02 §7.12.6): options filtered by age and safety rules. */
export function ParticipationCard({
  rule,
  value,
  onChange,
  showErrors,
}: {
  rule: ParticipationRule;
  value: ParticipationChoice;
  onChange: (c: ParticipationChoice) => void;
  showErrors: boolean;
}) {
  const { t } = useTranslation('ramadan');
  const testID = `ramadan-setup.member.${rule.memberId}`;
  const error = rule.fixed ? null : validateChoice(rule, value);
  return (
    <Card variant="outlined" testID={testID}>
      <Text variant="bodyStrong">{rule.name}</Text>
      {rule.notice ? (
        <InlineMessage
          tone={rule.notice === 'blocked' ? 'warning' : 'info'}
          message={t(`setup.notice.${rule.notice}`)}
          testID={`${testID}.notice`}
        />
      ) : null}
      {rule.fixed ? (
        <Text tone="muted" testID={`${testID}.fixed`}>
          {t('setup.fixedNotFasting')}
        </Text>
      ) : (
        <RadioCardGroup<Intention>
          label={t('setup.intentionLabel', { name: rule.name })}
          options={rule.options.map((o) => ({
            value: o,
            title: t(`intention.${o}.title`),
            description: t(`intention.${o}.body`),
          }))}
          value={value.intention}
          onChange={(i) => onChange(withIntention(value, i))}
          testID={`${testID}.intention`}
        />
      )}
      {value.intention === 'practice_fast' && value.practice ? (
        <>
          <ChipGroup
            label={t('setup.practiceDays')}
            single
            options={PRACTICE_DAYS.map((d) => ({ value: d, label: d }))}
            selected={[String(value.practice.daysPerWeek) as (typeof PRACTICE_DAYS)[number]]}
            onToggle={(d) =>
              onChange({
                ...value,
                practice: { until: value.practice?.until ?? 'dhuhr', daysPerWeek: Number(d) },
              })
            }
            testID={`${testID}.practice-days`}
          />
          <ChipGroup<PracticeUntil>
            label={t('setup.practiceUntil')}
            single
            options={PRACTICE_UNTIL.map((u) => ({ value: u, label: t(`until.${u}`) }))}
            selected={[value.practice.until]}
            onToggle={(u) =>
              onChange({
                ...value,
                practice: { daysPerWeek: value.practice?.daysPerWeek ?? 2, until: u },
              })
            }
            testID={`${testID}.practice-until`}
          />
        </>
      ) : null}
      {value.intention === 'exempt' ? (
        <ChipGroup<ExemptionReason>
          label={t('setup.exemptionLabel')}
          hint={t('setup.exemptionHint')}
          single
          options={SETUP_EXEMPTION_REASONS.map((r) => ({ value: r, label: t(`reason.${r}`) }))}
          selected={value.exemptionReason ? [value.exemptionReason] : []}
          onToggle={(r) => onChange({ ...value, exemptionReason: r })}
          testID={`${testID}.reason`}
        />
      ) : null}
      {value.intention === 'fasting' && rule.fastingNeedsClinicianAck ? (
        <Checkbox
          label={t('setup.clinicianAck')}
          description={t('setup.clinicianAckBody')}
          checked={value.clinicianAck}
          onChange={(clinicianAck) => onChange({ ...value, clinicianAck })}
          testID={`${testID}.clinician-ack`}
        />
      ) : null}
      {showErrors && error ? (
        <InlineMessage
          tone="danger"
          message={t(`setup.error.${error}`)}
          testID={`${testID}.error`}
        />
      ) : null}
    </Card>
  );
}
