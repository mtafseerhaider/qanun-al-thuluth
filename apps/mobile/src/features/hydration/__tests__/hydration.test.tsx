import { QueryClient } from '@tanstack/react-query';
import { screen } from '@testing-library/react-native';

import { clearOutboxHandlers, flushOutbox, useOutboxStore } from '@/lib/offline/outbox';
import { renderWithProviders } from '@/test/render';

import { insertHydrationLog } from '../api/hydration-api';
import { HydrationRing, KidCups } from '../components/hydration-ring';
import { logHydration, registerHydrationOutboxHandlers } from '../hooks/use-hydration';
import {
  aboveSafeRange,
  applyPendingHydration,
  classifyTiming,
  familyScore,
  HYDRATION_LOG_KIND,
  mlToCups,
  targetCups,
  usesKidCups,
} from '../utils/hydration-rules';
import { assessSymptoms, symptomsFor } from '../utils/symptom-rules';

jest.mock('expo-crypto', () => ({
  randomUUID: () => (jest.requireActual('crypto') as { randomUUID: () => string }).randomUUID(),
}));

jest.mock('../api/hydration-api', () => ({
  insertHydrationLog: jest.fn(async () => undefined),
  deleteHydrationLog: jest.fn(async () => undefined),
  fetchHydrationLogs: jest.fn(async () => []),
  fetchHydrationTargets: jest.fn(async () => []),
}));

const insertMock = insertHydrationLog as jest.MockedFunction<typeof insertHydrationLog>;

beforeEach(() => {
  useOutboxStore.getState().reset();
  clearOutboxHandlers();
  insertMock.mockClear();
});

describe('hydration rules (24 S4-08)', () => {
  it('shows children cups, never millilitres, rounded to half cups', () => {
    expect(usesKidCups('toddler')).toBe(true);
    expect(usesKidCups('child')).toBe(true);
    expect(usesKidCups('teen')).toBe(false);
    expect(usesKidCups('adult')).toBe(false);
    expect(mlToCups(300)).toBe(2);
    expect(mlToCups(220)).toBe(1.5);
    expect(targetCups(900)).toBe(6);
  });

  it('scores the family as the average share of each target, capped at 100 per person', () => {
    expect(
      familyScore([
        { targetMl: 2000, consumedMl: 3000 },
        { targetMl: 1000, consumedMl: 500 },
        { targetMl: 0, consumedMl: 200 },
      ]),
    ).toBe(75);
    expect(familyScore([{ targetMl: 0, consumedMl: 0 }])).toBeNull();
    expect(aboveSafeRange(4100, 2000)).toBe(true);
    expect(aboveSafeRange(3900, 2000)).toBe(false);
  });

  it('classifies a drink 30 minutes before lunch as pre-meal', () => {
    expect(classifyTiming(12 * 60, [], [12 * 60 + 30])).toBe('pre_meal');
  });
});

describe('offline hydration logging and replay (24 S4-08)', () => {
  it('queues one log per member offline, overlays it, then replays each once with its id', async () => {
    const writes = logHydration({
      householdId: 'h1',
      memberIds: ['m-1', 'm-2'],
      volumeMl: 250,
      beverage: 'water',
      timing: 'pre_meal',
      nowMinutes: 12 * 60,
    });
    const { entries } = useOutboxStore.getState();
    expect(entries).toHaveLength(2);
    expect(entries.every((e) => e.kind === HYDRATION_LOG_KIND)).toBe(true);
    // The tracker shows the queued drinks before they reach the server.
    const overlaid = applyPendingHydration([], entries);
    expect(overlaid.map((l) => l.volumeMl)).toEqual([250, 250]);
    expect(overlaid.every((l) => l.queued)).toBe(true);

    registerHydrationOutboxHandlers(new QueryClient());
    const outcome = await flushOutbox();
    expect(outcome.sent).toBe(2);
    expect(insertMock).toHaveBeenCalledTimes(2);
    expect(insertMock.mock.calls.map(([w]) => w.id).sort()).toEqual(writes.map((w) => w.id).sort());
    expect(useOutboxStore.getState().entries).toHaveLength(0);
  });

  it('keeps logs queued while the request fails offline', async () => {
    insertMock.mockRejectedValueOnce(new TypeError('Network request failed'));
    logHydration({
      householdId: 'h1',
      memberIds: ['m-1'],
      volumeMl: 150,
      beverage: 'milk',
      timing: 'other',
      nowMinutes: 600,
    });
    registerHydrationOutboxHandlers(new QueryClient());
    const outcome = await flushOutbox();
    expect(outcome.sent).toBe(0);
    expect(useOutboxStore.getState().entries).toHaveLength(1);
  });
});

describe('kid cup view (02 §7.12.2)', () => {
  it('renders cups for a child ring and no millilitres', async () => {
    await renderWithProviders(
      <HydrationRing consumedMl={300} targetMl={900} kid label="Ibrahim" testID="ring" />,
    );
    expect(screen.getByText('of 6 cups')).toBeTruthy();
    expect(screen.queryByText(/ml|L$/)).toBeNull();
  });

  it('fills cup icons to the nearest half cup', async () => {
    await renderWithProviders(<KidCups consumedMl={225} targetMl={600} testID="cups" />);
    expect(screen.getByTestId('cups.cup-0.full')).toBeTruthy();
    expect(screen.getByTestId('cups.cup-1.half')).toBeTruthy();
    expect(screen.getByTestId('cups.cup-2.empty')).toBeTruthy();
  });

  it('shows millilitres for an adult ring', async () => {
    await renderWithProviders(<HydrationRing consumedMl={1250} targetMl={2500} label="Ayesha" />);
    expect(screen.getByText('1.3 L')).toBeTruthy();
  });
});

describe('dehydration symptom check (24 S4-09)', () => {
  it('raises a red flag with urgent care for fainting or confusion', () => {
    expect(assessSymptoms(['fainting'], 400)).toMatchObject({
      level: 'red_flag',
      urgency: 'emergency_now',
    });
    expect(assessSymptoms(['dark_urine', 'dizziness'], 400)).toMatchObject({
      level: 'red_flag',
      urgency: 'same_day',
    });
    expect(assessSymptoms(['headache'], 400).level).toBe('mild');
    expect(assessSymptoms([], 400).level).toBe('none');
  });

  it('adds nappy and tear signs for young children and flags them as young', () => {
    expect(symptomsFor(24)).toContain('fewer_wet_nappies');
    expect(symptomsFor(120)).not.toContain('fewer_wet_nappies');
    expect(assessSymptoms(['no_tears'], 24)).toMatchObject({ youngChild: true });
  });
});
