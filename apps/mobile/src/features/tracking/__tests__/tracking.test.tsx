import type { ComponentProps } from 'react';
import { QueryClient } from '@tanstack/react-query';
import { screen } from '@testing-library/react-native';

import { useOutboxStore } from '@/lib/offline/outbox';
import { qk } from '@/lib/query/query-keys';
import { useActiveHouseholdStore } from '@/stores/use-active-household-store';
import { renderWithProviders } from '@/test/render';

import { logWeight, saveJournal } from '../hooks/use-tracking';
import { WeightLogScreen } from '../screens/weight-log-screen';
import {
  applyPendingWeights,
  canLogWeight,
  JOURNAL_SAVE_KIND,
  parseWaistCm,
  parseWeightKg,
  weightChange,
} from '../utils/tracking-rules';

jest.mock('expo-crypto', () => ({
  randomUUID: () => (jest.requireActual('crypto') as { randomUUID: () => string }).randomUUID(),
}));

const TODAY = '2026-10-06';

beforeEach(() => {
  useOutboxStore.getState().reset();
  useActiveHouseholdStore.getState().setActiveHousehold('h1', 'owner');
});

describe('no weight log for minors (FR-TRK-06, 00 §10)', () => {
  it('allows the weight log only from the 18th birthday', () => {
    expect(canLogWeight({ id: 'a', dateOfBirth: '2008-10-07', lifeStage: 'teen' }, TODAY)).toBe(
      false,
    );
    expect(canLogWeight({ id: 'a', dateOfBirth: '2008-10-06', lifeStage: 'adult' }, TODAY)).toBe(
      true,
    );
    // Without a birth date only an adult life stage counts.
    expect(canLogWeight({ id: 'a', dateOfBirth: null, lifeStage: 'teen' }, TODAY)).toBe(false);
    expect(canLogWeight({ id: 'a', dateOfBirth: null, lifeStage: null }, TODAY)).toBe(false);
    expect(canLogWeight({ id: 'a', dateOfBirth: null, lifeStage: 'older_adult' }, TODAY)).toBe(
      true,
    );
  });

  function client() {
    const c = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    c.setQueryData(qk.household('h1').familyMembers(), [
      { id: 'm-teen', name: 'Hamza', date_of_birth: '2011-02-01', life_stage: 'teen' },
      { id: 'm-mum', name: 'Ayesha', date_of_birth: '1990-01-01', life_stage: 'adult' },
    ]);
    return c;
  }

  it('shows the growth-chart message and no form when opened for a teen', async () => {
    await renderWithProviders(
      <WeightLogScreen
        {...({
          route: { params: { familyMemberId: 'm-teen' } },
          navigation: {},
        } as unknown as ComponentProps<typeof WeightLogScreen>)}
      />,
      { queryClient: client() },
    );
    expect(screen.getByTestId('weight.minor')).toBeTruthy();
    expect(screen.queryByTestId('weight.input')).toBeNull();
    expect(screen.queryByTestId('weight.member.m-teen')).toBeNull();
  });

  it('lists only adults and shows the form for them', async () => {
    await renderWithProviders(
      <WeightLogScreen
        {...({ route: { params: {} }, navigation: {} } as unknown as ComponentProps<
          typeof WeightLogScreen
        >)}
      />,
      { queryClient: client() },
    );
    expect(screen.getByTestId('weight.member.m-mum')).toBeTruthy();
    expect(screen.getByTestId('weight.input')).toBeTruthy();
    expect(screen.queryByTestId('weight.minor')).toBeNull();
  });
});

describe('weight entries', () => {
  it('parses metric and imperial input into kg within the stored range', () => {
    expect(parseWeightKg('72.5', 'metric')).toBe(72.5);
    expect(parseWeightKg('160', 'imperial')).toBe(72.6);
    expect(parseWeightKg('12', 'metric')).toBeNull();
    expect(parseWaistCm('')).toBeNull();
    expect(parseWaistCm('10')).toBe('invalid');
  });

  it('queues one entry per member and day, replacing an earlier one the same day', () => {
    const base = { householdId: 'h1', familyMemberId: 'm-mum', measuredOn: TODAY, waistCm: null };
    logWeight({ ...base, weightKg: 70 });
    logWeight({ ...base, weightKg: 69.8 });
    const { entries } = useOutboxStore.getState();
    expect(entries).toHaveLength(1);
    const view = applyPendingWeights(
      [
        {
          id: 'w-old',
          familyMemberId: 'm-mum',
          measuredOn: '2026-09-01',
          weightKg: 71,
          waistCm: null,
          bmi: 25,
        },
      ],
      entries,
      'm-mum',
    );
    expect(view[0]).toMatchObject({ measuredOn: TODAY, weightKg: 69.8, queued: true });
    expect(weightChange(view, TODAY)).toBe(-1.2);
  });
});

describe('nutrition journal (02 §7.5.4)', () => {
  it('never stores a thirds score for a child', () => {
    saveJournal(
      {
        householdId: 'h1',
        familyMemberId: 'm-teen',
        journalDate: TODAY,
        mood: 4,
        energy: null,
        digestion: null,
        thuluthAdherence: 3,
        notes: 'Played cricket',
      },
      true,
    );
    const [entry] = useOutboxStore.getState().entries;
    expect(entry?.kind).toBe(JOURNAL_SAVE_KIND);
    expect(entry?.payload).toMatchObject({ thuluthAdherence: null, mood: 4 });
  });
});
