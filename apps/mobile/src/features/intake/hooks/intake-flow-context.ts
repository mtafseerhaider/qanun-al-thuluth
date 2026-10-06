import { createContext, useContext } from 'react';

/** Callbacks from the host flow (onboarding today, the Family tab later) into the intake wizard. */
export interface IntakeFlowCallbacks {
  /** Review finished: move on to the assessment. */
  onComplete: () => void;
  /** Back from the first intake screen. */
  onExit: () => void;
}

export const IntakeFlowContext = createContext<IntakeFlowCallbacks>({
  onComplete: () => undefined,
  onExit: () => undefined,
});

export const useIntakeFlow = () => useContext(IntakeFlowContext);
