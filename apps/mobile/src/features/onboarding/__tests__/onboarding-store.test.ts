import {
  initialOnboarding,
  migrateOnboarding,
  nextStep,
  ONBOARDING_STORE_VERSION,
  previousStep,
  stepNumber,
  useOnboardingStore,
} from '../store/use-onboarding-store';
import { routeForStep } from '../utils/onboarding-routes';

beforeEach(() => useOnboardingStore.setState(initialOnboarding));

describe('useOnboardingStore', () => {
  it('advances through the steps and records completion', () => {
    const s = useOnboardingStore.getState();
    s.begin('user-1', 100);
    s.complete('welcome');
    s.complete('philosophy');
    const state = useOnboardingStore.getState();
    expect(state.currentStep).toBe('consents');
    expect(state.completedSteps).toEqual(['welcome', 'philosophy']);
    expect(state.startedAt).toBe(100);
  });

  it('resumes the same user where they left off and starts fresh for a different user', () => {
    const s = useOnboardingStore.getState();
    s.begin('user-1');
    s.complete('welcome');
    s.setCreatedHouseholdId('hh-1');
    useOnboardingStore.getState().begin('user-1');
    expect(useOnboardingStore.getState().currentStep).toBe('philosophy');
    expect(useOnboardingStore.getState().createdHouseholdId).toBe('hh-1');

    useOnboardingStore.getState().begin('user-2');
    expect(useOnboardingStore.getState()).toMatchObject({
      userId: 'user-2',
      currentStep: 'welcome',
      completedSteps: [],
      createdHouseholdId: null,
    });
  });

  it('skips the household step for invitees', () => {
    const s = useOnboardingStore.getState();
    s.begin('user-1');
    s.setJoinedByInvite(true);
    s.complete('consents');
    expect(useOnboardingStore.getState().currentStep).toBe('members');
    expect(nextStep('philosophy', { skipHousehold: true })).toBe('consents');
    expect(nextStep('members')).toBe('done');
  });

  it('persists only serialisable progress under a versioned key', () => {
    const options = useOnboardingStore.persist.getOptions();
    expect(options.name).toBe('store.onboarding');
    expect(options.version).toBe(ONBOARDING_STORE_VERSION);
    useOnboardingStore.getState().begin('user-1', 5);
    const persisted = options.partialize?.(useOnboardingStore.getState());
    expect(Object.keys(persisted ?? {}).sort()).toEqual(
      [
        'completedSteps',
        'createdHouseholdId',
        'currentStep',
        'householdDraft',
        'joinedByInvite',
        'startedAt',
        'userId',
      ].sort(),
    );
  });

  it('rehydrates a persisted draft so a killed app resumes at the household step', async () => {
    const draft = {
      id: 'hh-draft',
      name: 'Khan family',
      country_code: 'PK',
      city: 'Lahore',
      currency: 'PKR',
      timezone: 'Asia/Karachi',
      budgetMajor: '45000',
    };
    const storage = useOnboardingStore.persist.getOptions().storage;
    await storage?.setItem('store.onboarding', {
      state: {
        ...initialOnboarding,
        userId: 'user-1',
        currentStep: 'household',
        completedSteps: ['welcome', 'philosophy', 'consents'],
        householdDraft: draft,
      },
      version: ONBOARDING_STORE_VERSION,
    });
    await useOnboardingStore.persist.rehydrate();
    const state = useOnboardingStore.getState();
    expect(state.currentStep).toBe('household');
    expect(state.householdDraft).toEqual(draft);
    expect(routeForStep(state.currentStep)).toBe('OnboardingHousehold');
  });
});

describe('migrateOnboarding', () => {
  it('drops unknown steps and resumes at welcome', () => {
    expect(
      migrateOnboarding({ currentStep: 'intake', completedSteps: ['welcome', 'bogus'] }, 0),
    ).toMatchObject({ currentStep: 'welcome', completedSteps: ['welcome'] });
    expect(migrateOnboarding(undefined, 0)).toEqual(initialOnboarding);
  });
});

it('numbers steps and walks back', () => {
  expect(stepNumber('welcome')).toBe(1);
  expect(stepNumber('members')).toBe(5);
  expect(previousStep('household')).toBe('consents');
  expect(previousStep('welcome')).toBeNull();
});
