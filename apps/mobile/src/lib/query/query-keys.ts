/** Query key factory (09 §3). Sprint 0 subset; later sprints extend it in place. */
type Id = string;

export const qk = {
  me: () => ['me'] as const,
  profile: () => [...qk.me(), 'profile'] as const,
  subscription: () => [...qk.me(), 'subscription'] as const,
  featureFlags: () => ['feature-flags'] as const,
  household: (hid: Id) => {
    const base = ['household', hid] as const;
    return {
      all: () => base,
      detail: () => [...base, 'detail'] as const,
      familyMembers: () => [...base, 'family-members'] as const,
    };
  },
  debug: {
    aiSmoke: () => ['debug', 'ai-smoke'] as const,
  },
} as const;
