import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { ageInYears, CHILD_AGE_YEARS } from '@shared';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { deviceIsoDate } from '@/lib/dates/local-date';
import { useActiveHouseholdStore } from '@/stores/use-active-household-store';

import { useFamilyMembers } from '../hooks/use-family-members';

const MINOR_STAGES = ['infant', 'toddler', 'child', 'teen'];

/** Minor by birth date, else by life stage; unknown counts as a minor (no numbers). */
export function isMinor(
  m: { date_of_birth: string | null; life_stage: string | null },
  today: string,
): boolean {
  if (m.date_of_birth) {
    try {
      return ageInYears(m.date_of_birth, today) < CHILD_AGE_YEARS;
    } catch {
      // fall through to the life stage
    }
  }
  return m.life_stage ? MINOR_STAGES.includes(m.life_stage) : true;
}

export type ModuleLink = 'growth' | 'picky' | 'autism';

/** Which module screens a member gets (children: growth; module members: picky, autism). */
export function moduleLinksFor(
  m: { special_modules: readonly string[] | null },
  minor: boolean,
  isViewer: boolean,
): ModuleLink[] {
  const out: ModuleLink[] = [];
  if (minor && !isViewer) out.push('growth');
  const mods = m.special_modules ?? [];
  if (mods.includes('picky_eater')) out.push('picky');
  if (mods.includes('autism')) out.push('autism');
  return out;
}

/** Sprint 6 entry points on Family: growth charts, picky-eating and autism modules per member. */
export function HealthModulesCard({
  householdId,
  onOpen,
}: {
  householdId: string;
  onOpen: (link: ModuleLink, familyMemberId: string) => void;
}) {
  const { t } = useTranslation('family');
  const members = useFamilyMembers(householdId);
  const today = deviceIsoDate(new Date());
  const role = useActiveHouseholdStore((s) => s.activeRole);
  const rows = (members.data ?? [])
    .map((m) => ({ m, links: moduleLinksFor(m, isMinor(m, today), role === 'viewer') }))
    .filter((r) => r.links.length > 0);
  if (rows.length === 0) return null;
  return (
    <Card testID="family-management.modules">
      <Text variant="heading" accessibilityRole="header">
        {t('modules.title')}
      </Text>
      {rows.map(({ m, links }) => (
        <View key={m.id} className="gap-1">
          <Text variant="bodyStrong">{m.name}</Text>
          <View className="flex-row flex-wrap gap-2">
            {links.map((l) => (
              <Button
                key={l}
                label={t(`modules.${l}`)}
                accessibilityLabel={t('modules.a11y', { module: t(`modules.${l}`), name: m.name })}
                size="sm"
                variant="secondary"
                onPress={() => onOpen(l, m.id)}
                testID={`family-management.module.${l}.${m.id}`}
              />
            ))}
          </View>
        </View>
      ))}
    </Card>
  );
}
