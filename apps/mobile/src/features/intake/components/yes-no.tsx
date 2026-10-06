import { useTranslation } from 'react-i18next';

import { RadioCardGroup } from '@/components/ui/radio-card-group';

/** Yes / No (and optionally "Prefer not to say") as an inline radio group. */
export function YesNo<T extends 'yes' | 'no' | 'prefer_not_to_say'>({
  label,
  hint,
  value,
  onChange,
  withPreferNot = false,
  testID,
}: {
  label: string;
  hint?: string;
  value: T | null;
  onChange: (v: T) => void;
  withPreferNot?: boolean;
  testID: string;
}) {
  const { t } = useTranslation('intake');
  const options = [
    { value: 'yes', title: t('common.yes') },
    { value: 'no', title: t('common.no') },
    ...(withPreferNot ? [{ value: 'prefer_not_to_say', title: t('common.preferNot') }] : []),
  ] as Array<{ value: T; title: string }>;
  return (
    <RadioCardGroup
      label={label}
      {...(hint ? { hint } : {})}
      options={options}
      value={value}
      onChange={onChange}
      inline
      testID={testID}
    />
  );
}

export const boolToYesNo = (b: boolean | undefined): 'yes' | 'no' | null =>
  b === undefined ? null : b ? 'yes' : 'no';
