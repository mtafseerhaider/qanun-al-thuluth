import { onlineManager } from '@tanstack/react-query';
import { fireEvent, screen } from '@testing-library/react-native';

import { renderWithProviders } from '@/test/render';

import { PlanGenerationFlow, type GenerationJob } from '../components/plan-generation-flow';

type Watch = {
  plan: { id: string; status: string; rationale: string | null; progress: unknown } | null;
  outcome: 'generating' | 'ready' | 'failed';
  stage: { stage: string; percent: number };
  timedOut: boolean;
  query: { refetch: jest.Mock };
  realtime: string;
};
let mockWatch: Watch;
const mockActivate = { mutate: jest.fn(), isPending: false, isError: false, error: null };
jest.mock('../hooks/use-plans', () => ({
  usePlanGenerationWatch: () => mockWatch,
  useActivatePlan: () => mockActivate,
}));

const JOB: GenerationJob = {
  mealPlanId: 'plan-1',
  pollAfterMs: 2000,
  startedAt: Date.now(),
  mode: 'full',
};
const generating = (patch: Partial<Watch> = {}): Watch => ({
  plan: { id: 'plan-1', status: 'generating', rationale: null, progress: null },
  outcome: 'generating',
  stage: { stage: 'choosing', percent: 55 },
  timedOut: false,
  query: { refetch: jest.fn() },
  realtime: 'subscribed',
  ...patch,
});

function renderFlow(props: Partial<Parameters<typeof PlanGenerationFlow>[0]> = {}) {
  const onStart = jest.fn();
  const onFinished = jest.fn();
  const view = renderWithProviders(
    <PlanGenerationFlow
      householdId="h1"
      job={JOB}
      onStart={onStart}
      starting={false}
      startError={null}
      autoActivate
      onFinished={onFinished}
      testID="first-plan"
      {...props}
    />,
  );
  return { view, onStart, onFinished };
}

beforeEach(() => {
  jest.clearAllMocks();
  onlineManager.setOnline(true);
});

describe('PlanGenerationFlow (24 S3-07)', () => {
  it('shows the stepper and educational tips while generating', async () => {
    mockWatch = generating();
    await renderFlow().view;
    expect(screen.getByTestId('first-plan.stepper')).toBeTruthy();
    expect(screen.getByTestId('first-plan.tips')).toBeTruthy();
  });

  it('offers the template fallback after the timeout', async () => {
    mockWatch = generating({ timedOut: true });
    const { view, onStart } = renderFlow();
    await view;
    await fireEvent.press(screen.getByTestId('first-plan.timeout-template'));
    expect(onStart).toHaveBeenCalledWith('template');
  });

  it('on failure offers retry and the template plan', async () => {
    mockWatch = generating({
      outcome: 'failed',
      plan: {
        id: 'plan-1',
        status: 'failed',
        rationale: null,
        progress: {
          phase: 'failed',
          completed_weeks: 0,
          total_weeks: 1,
          attempt: 2,
          error_code: 'AI_TIMEOUT',
        },
      },
    });
    const { view, onStart } = renderFlow();
    await view;
    expect(screen.getByText('Reference: AI_TIMEOUT')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('first-plan.retry'));
    await fireEvent.press(screen.getByTestId('first-plan.template'));
    expect(onStart.mock.calls).toEqual([['retry'], ['template']]);
  });

  it('activates the first draft automatically and finishes once active', async () => {
    mockWatch = generating({
      outcome: 'ready',
      plan: { id: 'plan-1', status: 'draft', rationale: 'r', progress: null },
    });
    await renderFlow().view;
    expect(mockActivate.mutate).toHaveBeenCalledWith('plan-1', expect.anything());
    expect(screen.queryByTestId('first-plan.ready')).toBeNull();
  });

  it('shows "See today" when the plan is active', async () => {
    mockWatch = generating({
      outcome: 'ready',
      plan: { id: 'plan-1', status: 'active', rationale: 'Built around daal', progress: null },
    });
    const { view, onFinished } = renderFlow();
    await view;
    await fireEvent.press(screen.getByTestId('first-plan.done'));
    expect(onFinished).toHaveBeenCalled();
  });

  it('cannot start while offline', async () => {
    onlineManager.setOnline(false);
    mockWatch = generating({ plan: null });
    await renderFlow({ job: null }).view;
    expect(screen.getByTestId('first-plan.offline')).toBeTruthy();
    expect(screen.getByTestId('first-plan.create')).toBeDisabled();
  });
});
