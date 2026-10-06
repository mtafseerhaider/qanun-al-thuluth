import type { ComponentProps } from 'react';
import { QueryClient } from '@tanstack/react-query';
import { screen } from '@testing-library/react-native';

import { deviceIsoDate } from '@/lib/dates/local-date';
import { useOutboxStore } from '@/lib/offline/outbox';
import { qk } from '@/lib/query/query-keys';
import { useActiveHouseholdStore } from '@/stores/use-active-household-store';
import { renderWithProviders } from '@/test/render';

import { FastingTrackerScreen } from '../screens/fasting-tracker-screen';
import {
  availableKinds,
  buildFastingWrite,
  canSeePrivateFasting,
  fastingEligibility,
  NO_SAFETY,
  qadaBalance,
  validateFastForm,
  type FastFormValues,
  type FastingLogView,
  type FastingMember,
} from '../utils/fasting-rules';

jest.mock('expo-crypto', () => ({
  randomUUID: () => (jest.requireActual('crypto') as { randomUUID: () => string }).randomUUID(),
}));

const TODAY = '2026-10-06';
const member = (over: Partial<FastingMember>): FastingMember => ({
  id: 'm-1',
  name: 'Ayesha',
  dateOfBirth: '1990-01-01',
  lifeStage: 'adult',
  specialModules: [],
  linkedUserId: null,
  ...over,
});
const form = (over: Partial<FastFormValues> = {}): FastFormValues => ({
  memberId: 'm-1',
  date: TODAY,
  kind: 'ramadan',
  outcome: 'completed',
  exemptionReason: null,
  practicePattern: null,
  notes: '',
  startedAt: null,
  endedAt: null,
  qadaForHijriYear: null,
  ...over,
});

describe('child fasting rules (FR-FAST-06)', () => {
  it('offers no fasts at all under 7', () => {
    const e = fastingEligibility(
      member({ dateOfBirth: '2020-03-01', lifeStage: 'child' }),
      NO_SAFETY,
      TODAY,
    );
    expect(e).toEqual({ mode: 'under_7' });
    expect(availableKinds(e)).toEqual([]);
    expect(validateFastForm(form(), e, TODAY)).toBe('not_allowed');
  });

  it('treats a child without a birth date as under 7 (safest rule)', () => {
    expect(
      fastingEligibility(member({ dateOfBirth: null, lifeStage: 'child' }), NO_SAFETY, TODAY).mode,
    ).toBe('under_7');
  });

  it('gives children from 7 practice fasts only, logged as practice', () => {
    const e = fastingEligibility(
      member({ dateOfBirth: '2018-05-01', lifeStage: 'child' }),
      NO_SAFETY,
      TODAY,
    );
    expect(e).toEqual({ mode: 'practice' });
    expect(availableKinds(e)).toEqual(['ramadan', 'nafl']);
    expect(validateFastForm(form({ kind: 'intermittent' }), e, TODAY)).toBe('kind_not_allowed');
    const w = buildFastingWrite(form({ practicePattern: 'until_dhuhr' }), {
      id: 'f-1',
      householdId: 'h1',
      eligibility: e,
    });
    expect(w).toMatchObject({ isPracticeFast: true, notes: 'practice_until_dhuhr' });
  });

  it('never offers intermittent fasting to minors or in pregnancy', () => {
    const teen = fastingEligibility(
      member({ dateOfBirth: '2010-01-01', lifeStage: 'teen' }),
      NO_SAFETY,
      TODAY,
    );
    expect(availableKinds(teen)).not.toContain('intermittent');
    const pregnant = fastingEligibility(
      member({ specialModules: ['pregnancy'] }),
      NO_SAFETY,
      TODAY,
    );
    expect(pregnant).toMatchObject({
      mode: 'full',
      decideWithClinician: true,
      intermittentAllowed: false,
    });
    expect(availableKinds(fastingEligibility(member({}), NO_SAFETY, TODAY))).toContain(
      'intermittent',
    );
  });
});

describe('fasting safety block (FR-FAST-07)', () => {
  it('blocks fasting for insulin or a sulfonylurea', () => {
    const e = fastingEligibility(
      member({}),
      { ...NO_SAFETY, reasons: ['insulin_or_sulfonylurea'] },
      TODAY,
    );
    expect(e).toEqual({ mode: 'blocked', reasons: ['insulin_or_sulfonylurea'] });
    expect(validateFastForm(form(), e, TODAY)).toBe('not_allowed');
  });

  it('shows the clinician card and no log button on the tracker', async () => {
    useActiveHouseholdStore.getState().setActiveHousehold('h1', 'owner');
    useOutboxStore.getState().reset();
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    const h = qk.household('h1');
    client.setQueryData(h.familyMembers(), [
      {
        id: 'm-1',
        name: 'Abbu',
        date_of_birth: '1960-01-01',
        life_stage: 'older_adult',
        special_modules: [],
        linked_user_id: null,
      },
    ]);
    client.setQueryData(h.fastingSafety(), {
      'm-1': { reasons: ['insulin_or_sulfonylurea'], pregnant: false, breastfeeding: false },
    });
    client.setQueryData(h.fastingLogs(), []);
    await renderWithProviders(
      <FastingTrackerScreen
        {...({
          route: { params: {} },
          navigation: { navigate: jest.fn() },
        } as unknown as ComponentProps<typeof FastingTrackerScreen>)}
      />,
      { queryClient: client },
    );
    expect(screen.getByTestId('fasting.clinician-card')).toBeTruthy();
    expect(screen.getByTestId('fasting.clinician-card.insulin_or_sulfonylurea')).toBeTruthy();
    expect(screen.queryByTestId('fasting.log')).toBeNull();
  });

  it('shows the under-7 notice instead of the log button for a young child', async () => {
    useActiveHouseholdStore.getState().setActiveHousehold('h1', 'owner');
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    const h = qk.household('h1');
    client.setQueryData(h.familyMembers(), [
      {
        id: 'm-2',
        name: 'Zainab',
        date_of_birth: deviceIsoDate(new Date(Date.now() - 4 * 365 * 86_400_000)),
        life_stage: 'child',
        special_modules: [],
        linked_user_id: null,
      },
    ]);
    client.setQueryData(h.fastingSafety(), {});
    client.setQueryData(h.fastingLogs(), []);
    const navigate = jest.fn();
    await renderWithProviders(
      <FastingTrackerScreen
        {...({ route: { params: {} }, navigation: { navigate } } as unknown as ComponentProps<
          typeof FastingTrackerScreen
        >)}
      />,
      { queryClient: client },
    );
    expect(screen.getByTestId('fasting.under-7')).toBeTruthy();
    expect(screen.queryByTestId('fasting.log')).toBeNull();
    expect(screen.queryByTestId('fasting.ramadan')).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe('qada and privacy (FR-FAST-02)', () => {
  const log = (over: Partial<FastingLogView>): FastingLogView => ({
    id: 'l',
    familyMemberId: 'm-1',
    fastDate: '2026-03-01',
    kind: 'ramadan',
    startedAt: null,
    endedAt: null,
    completed: false,
    exemptionReason: 'travel',
    isPracticeFast: false,
    notes: null,
    hijriDate: null,
    qadaForHijriYear: null,
    ...over,
  });

  it('counts missed Ramadan days against completed qada fasts', () => {
    const b = qadaBalance(
      [
        log({ id: 'a', fastDate: '2026-03-01' }),
        log({ id: 'b', fastDate: '2026-03-02', exemptionReason: 'illness' }),
        log({ id: 'c', fastDate: '2026-03-03', completed: true, exemptionReason: null }),
        log({
          id: 'd',
          fastDate: '2026-05-01',
          kind: 'qada',
          completed: true,
          exemptionReason: null,
        }),
      ],
      'm-1',
    );
    expect(b).toMatchObject({ missed: 2, madeUp: 1, remaining: 1, permanent: false });
  });

  it('shows reasons only to the member, or to the owner for a member without an account', () => {
    expect(canSeePrivateFasting({ linkedUserId: 'u-2' }, { userId: 'u-1', isOwner: true })).toBe(
      false,
    );
    expect(canSeePrivateFasting({ linkedUserId: 'u-2' }, { userId: 'u-2', isOwner: false })).toBe(
      true,
    );
    expect(canSeePrivateFasting({ linkedUserId: null }, { userId: 'u-1', isOwner: true })).toBe(
      true,
    );
    expect(canSeePrivateFasting({ linkedUserId: null }, { userId: 'u-3', isOwner: false })).toBe(
      false,
    );
  });
});
