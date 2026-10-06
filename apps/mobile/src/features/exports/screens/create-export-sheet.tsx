import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  EXPORT_PDF_MVP_KINDS,
  type ExportPaper,
  type ExportPdfMvpKind,
  type ExportPdfParams,
} from '@shared/contracts';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { ChipGroup } from '@/components/ui/chip';
import { InlineMessage } from '@/components/ui/inline-message';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { useFamilyMembers } from '@/features/family';
import { useGroceryLists } from '@/features/grocery';
import { memberAge } from '@/features/meal-log';
import { useHouseholdClock } from '@/features/meals';
import { useActivePlan } from '@/features/plan';
import { UpsellCard, usePremium } from '@/features/subscription';
import { errorKeyFor } from '@/lib/supabase/error-mapping';
import type { RootScreenProps } from '@/navigation/types';
import { useActiveHouseholdStore } from '@/stores/use-active-household-store';
import { usePreferencesStore } from '@/stores/use-preferences-store';

import { useCreateExport } from '../hooks/use-exports';
import { exportProblem, needsChildDataConfirm } from '../utils/export-rules';

const PAPERS: readonly ExportPaper[] = ['A4', 'Letter'];

/**
 * Create export (02 §7.13.8, 18 Part A; FR-EXP-01 to -04; premium). Meal plan, grocery list or a
 * child's growth report, in English or Urdu (RTL), on A4 or Letter. The PDF opens in the native
 * share sheet (WhatsApp, email, print). The download link lasts 24 hours.
 */
export function CreateExportSheet({ route, navigation }: RootScreenProps<'CreateExportSheet'>) {
  const p = route.params;
  const { t } = useTranslation('exports');
  const householdId = useActiveHouseholdStore((s) => s.activeHouseholdId);
  const appLocale = usePreferencesStore((s) => s.locale);
  const { premium } = usePremium(householdId);
  const clock = useHouseholdClock(householdId);
  const plan = useActivePlan(householdId);
  const lists = useGroceryLists(householdId);
  const members = useFamilyMembers(householdId);
  const children = useMemo(
    () => (members.data ?? []).filter((m) => memberAge(m, clock.today).minor),
    [members.data, clock.today],
  );
  const initialKind = (EXPORT_PDF_MVP_KINDS as readonly string[]).includes(p?.kind ?? '')
    ? (p?.kind as ExportPdfMvpKind)
    : 'meal_plan';
  const [kind, setKind] = useState<ExportPdfMvpKind>(initialKind);
  const [locale, setLocale] = useState<'en' | 'ur'>(appLocale);
  const [paper, setPaper] = useState<ExportPaper>('A4');
  const [childId, setChildId] = useState<string | null>(p?.familyMemberId ?? null);
  const [confirmed, setConfirmed] = useState(false);
  const create = useCreateExport();

  const mealPlanId = p?.mealPlanId ?? plan.data?.id ?? null;
  const groceryListId = p?.groceryListId ?? lists.data?.[0]?.id ?? null;
  const memberId = childId ?? children[0]?.id ?? null;
  const params: ExportPdfParams | null =
    kind === 'meal_plan'
      ? mealPlanId
        ? { kind, meal_plan_id: mealPlanId, include_recipes: true, include_sources: true }
        : null
      : kind === 'grocery_list'
        ? groceryListId
          ? { kind, grocery_list_id: groceryListId, group_by: 'aisle' }
          : null
        : memberId
          ? { kind, family_member_id: memberId, include_notes_for_clinician: true }
          : null;
  const problem = create.error ? exportProblem(create.error) : null;
  const canSubmit =
    Boolean(householdId && params) &&
    (!needsChildDataConfirm(kind) || confirmed) &&
    !create.isPending;

  const submit = () => {
    if (!householdId || !params) return;
    create.mutate(
      {
        householdId,
        kind,
        params,
        locale,
        paper,
        today: clock.today,
        dialogTitle: t('shareTitle'),
      },
      { onSuccess: () => navigation.goBack() },
    );
  };

  return (
    <Screen testID="export-create.screen">
      <Text variant="title" accessibilityRole="header">
        {t('create.title')}
      </Text>
      {!premium ? (
        <UpsellCard
          trigger="export"
          title={t('upsellTitle')}
          body={t('upsellBody')}
          testID="export-create.upsell"
        />
      ) : null}
      <ChipGroup
        label={t('create.kind')}
        single
        options={EXPORT_PDF_MVP_KINDS.map((k) => ({ value: k, label: t(`kinds.${k}`) }))}
        selected={[kind]}
        onToggle={(k) => {
          setKind(k);
          setConfirmed(false);
        }}
        testID="export-create.kind"
      />
      {kind === 'growth_report' ? (
        children.length === 0 ? (
          <Text tone="muted">{t('create.noChildren')}</Text>
        ) : (
          <ChipGroup
            label={t('create.child')}
            single
            options={children.map((c) => ({ value: c.id, label: c.name }))}
            selected={memberId ? [memberId] : []}
            onToggle={setChildId}
            testID="export-create.child"
          />
        )
      ) : null}
      {!params && kind !== 'growth_report' ? (
        <Text tone="muted" testID="export-create.missing">
          {t(`create.missing.${kind}`)}
        </Text>
      ) : null}
      <ChipGroup
        label={t('create.language')}
        single
        options={(['en', 'ur'] as const).map((l) => ({ value: l, label: t(`languages.${l}`) }))}
        selected={[locale]}
        onToggle={setLocale}
        testID="export-create.locale"
      />
      <ChipGroup
        label={t('create.paper')}
        single
        options={PAPERS.map((x) => ({ value: x, label: t(`papers.${x}`) }))}
        selected={[paper]}
        onToggle={setPaper}
        testID="export-create.paper"
      />
      {needsChildDataConfirm(kind) ? (
        <Card variant="filled">
          <Checkbox
            label={t('create.childConfirm')}
            checked={confirmed}
            onChange={setConfirmed}
            testID="export-create.confirm"
          />
        </Card>
      ) : null}
      <Text variant="caption" tone="muted">
        {t('create.linkNote')}
      </Text>
      {problem === 'not_available' ? (
        <InlineMessage
          tone="info"
          title={t('notAvailableTitle')}
          message={t('notAvailableBody')}
          testID="export-create.not-available"
        />
      ) : problem === 'premium' ? (
        <UpsellCard
          trigger="export"
          title={t('upsellTitle')}
          body={t('upsellBody')}
          testID="export-create.premium"
        />
      ) : problem && problem !== 'generic' ? (
        <InlineMessage
          tone="danger"
          message={t(`problems.${problem}`)}
          testID="export-create.error"
        />
      ) : create.error ? (
        <InlineMessage tone="danger" message={t(`errors:${errorKeyFor(create.error)}`)} />
      ) : null}
      {create.isPending ? (
        <Text tone="muted" testID="export-create.progress">
          {t('create.preparing')}
        </Text>
      ) : null}
      <Button
        label={t('create.submit')}
        onPress={submit}
        disabled={!canSubmit || !premium}
        loading={create.isPending}
        fullWidth
        testID="export-create.submit"
      />
    </Screen>
  );
}
