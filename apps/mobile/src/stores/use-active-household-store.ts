import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';

import { appJsonStorage } from '@/lib/storage/zustand-storage';

import { resetters } from './create-store';

/** Active household and member selection (09 §5.2). The role is never persisted: the server decides. */
export type HouseholdRole = 'owner' | 'caregiver' | 'viewer' | 'coach';

export interface ActiveHouseholdState {
  activeHouseholdId: string | null;
  activeRole: HouseholdRole | null;
  activeMemberId: string | null;
  lastMemberByHousehold: Record<string, string>;
}

export interface ActiveHouseholdActions {
  setActiveHousehold(householdId: string, role: HouseholdRole | null): void;
  setActiveMember(memberId: string | null): void;
  reconcile(
    memberships: Array<{ household_id: string; role: HouseholdRole }>,
    members?: Array<{ id: string }>,
  ): void;
  reset(): void;
}

export const initialActiveHousehold: ActiveHouseholdState = {
  activeHouseholdId: null,
  activeRole: null,
  activeMemberId: null,
  lastMemberByHousehold: {},
};

export const ACTIVE_HOUSEHOLD_STORE_VERSION = 1;

export const useActiveHouseholdStore = create<ActiveHouseholdState & ActiveHouseholdActions>()(
  devtools(
    persist(
      (set, get) => ({
        ...initialActiveHousehold,
        setActiveHousehold: (householdId, role) =>
          set({
            activeHouseholdId: householdId,
            activeRole: role,
            activeMemberId: get().lastMemberByHousehold[householdId] ?? null,
          }),
        setActiveMember: (memberId) => {
          const hid = get().activeHouseholdId;
          set((s) => ({
            activeMemberId: memberId,
            lastMemberByHousehold:
              hid && memberId
                ? { ...s.lastMemberByHousehold, [hid]: memberId }
                : s.lastMemberByHousehold,
          }));
        },
        reconcile: (memberships, members) => {
          const { activeHouseholdId, activeMemberId } = get();
          const current =
            memberships.find((m) => m.household_id === activeHouseholdId) ?? memberships[0];
          if (!current) {
            set(initialActiveHousehold);
            return;
          }
          set({
            activeHouseholdId: current.household_id,
            activeRole: current.role,
            activeMemberId: !members
              ? activeMemberId
              : members.some((m) => m.id === activeMemberId)
                ? activeMemberId
                : (members[0]?.id ?? null),
          });
        },
        reset: () => set(initialActiveHousehold),
      }),
      {
        name: 'store.active-household',
        version: ACTIVE_HOUSEHOLD_STORE_VERSION,
        storage: appJsonStorage,
        partialize: (s) => ({
          activeHouseholdId: s.activeHouseholdId,
          activeMemberId: s.activeMemberId,
          lastMemberByHousehold: s.lastMemberByHousehold,
        }),
      },
    ),
    { name: 'active-household', enabled: __DEV__ },
  ),
);

resetters.add(() => useActiveHouseholdStore.getState().reset());

export const selectActiveHouseholdId = (s: ActiveHouseholdState) => s.activeHouseholdId;
export const selectCanEdit = (s: ActiveHouseholdState) =>
  s.activeRole === 'owner' || s.activeRole === 'caregiver';
export const selectIsOwner = (s: ActiveHouseholdState) => s.activeRole === 'owner';
