import { createStore, resetters } from '@/stores/create-store';

import {
  codeExpired,
  codeSent,
  initialOtpFlow,
  wrongCode,
  type OtpFlowState,
} from '../utils/otp-flow';

/** In-memory OTP flow shared by Login and OtpVerify (11 §3.3). Never persisted. */
export interface OtpActions {
  markSent(email: string, now?: number): void;
  markWrongCode(): void;
  markExpired(now?: number): void;
  reset(): void;
}

export const useOtpStore = createStore<OtpFlowState & OtpActions>('otp-flow', (set) => ({
  ...initialOtpFlow,
  markSent: (email, now = Date.now()) => set((s) => codeSent(s, email, now)),
  markWrongCode: () => set((s) => wrongCode(s)),
  markExpired: (now = Date.now()) => set((s) => codeExpired(s, now)),
  reset: () => set(initialOtpFlow),
}));

resetters.add(() => useOtpStore.getState().reset());
