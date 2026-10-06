import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useMemo, useState } from 'react';

import {
  completeness,
  intakeContext,
  nextIntakeStep,
  previousIntakeStep,
  visibleSteps,
  type IntakeContext,
  type IntakeMemberProfile,
  type MemberIntakeAnswers,
  type MemberIntakeStep,
} from '@shared/intake/questions';

import { useFamilyMembers, type FamilyMember } from '@/features/family';
import { track } from '@/lib/analytics/track';
import type { IntakeStackParamList } from '@/navigation/types';
import { useActiveHouseholdStore } from '@/stores/use-active-household-store';

import { selectMemberDraft, useIntakeDraftStore } from '../store/use-intake-draft-store';
import { memberStepTarget } from '../utils/intake-routes';

const EMPTY: MemberIntakeAnswers = Object.freeze({}) as MemberIntakeAnswers;

export function useIntakeHouseholdId(): string | null {
  return useActiveHouseholdStore((s) => s.activeHouseholdId);
}

/**
 * The member's profile for the engine. A member without a date of birth is treated as a child
 * (safest default: no weight goals, no calorie numbers) until a date is entered.
 */
export function memberProfile(
  m: Pick<FamilyMember, 'date_of_birth' | 'sex_at_birth'>,
): IntakeMemberProfile {
  const fallback = new Date();
  fallback.setUTCFullYear(fallback.getUTCFullYear() - 10);
  return {
    date_of_birth: m.date_of_birth ?? fallback.toISOString().slice(0, 10),
    sex_at_birth: m.sex_at_birth,
  };
}

export function useIntakeMember(familyMemberId: string) {
  const householdId = useIntakeHouseholdId();
  const members = useFamilyMembers(householdId);
  const member = members.data?.find((m) => m.id === familyMemberId) ?? null;
  const draft = useIntakeDraftStore(selectMemberDraft(familyMemberId));
  const answers = draft?.answers ?? EMPTY;
  const ctx: IntakeContext | null = useMemo(
    () => (member ? intakeContext(memberProfile(member), answers) : null),
    [member, answers],
  );
  const update = (patch: Partial<MemberIntakeAnswers>) =>
    useIntakeDraftStore.getState().updateAnswers(familyMemberId, patch);
  return { householdId, member, answers, ctx, update, loading: members.isLoading };
}

type Nav = NativeStackNavigationProp<IntakeStackParamList>;

/**
 * Controller for one per-member step (08 §7.4): progress over the member's visible steps, save on
 * Next (server write, then the draft is marked complete), Back, and "Finish later".
 */
export function useMemberStep(step: MemberIntakeStep, familyMemberId: string) {
  const navigation = useNavigation<Nav>();
  const info = useIntakeMember(familyMemberId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const steps = info.ctx ? visibleSteps(info.ctx, info.answers) : [];
  const score = info.ctx ? completeness(info.ctx, info.answers).score : 0;

  const toHub = () => {
    useIntakeDraftStore.getState().setView('members', null);
    navigation.popTo('IntakeMembers');
  };

  const latest = () => {
    const answers = useIntakeDraftStore.getState().members[familyMemberId]?.answers ?? EMPTY;
    const ctx = info.member ? intakeContext(memberProfile(info.member), answers) : null;
    return { answers, ctx };
  };

  const next = async (save?: () => Promise<void>) => {
    setSaving(true);
    setError(null);
    try {
      await save?.();
    } catch (e) {
      setError(e);
      setSaving(false);
      return;
    }
    setSaving(false);
    const store = useIntakeDraftStore.getState();
    store.completeStep(familyMemberId, step);
    track('intake_step_completed', { step });
    const { answers, ctx } = latest();
    const following = ctx ? nextIntakeStep(ctx, answers, step) : null;
    if (!following || !ctx) {
      toHub();
      return;
    }
    store.setView('member', { memberId: familyMemberId, step: following });
    const target = memberStepTarget(following, familyMemberId, ctx.modules);
    navigation.push(target.name, target.params as never);
  };

  const back = () => {
    const { answers, ctx } = latest();
    const prev = ctx ? previousIntakeStep(ctx, answers, step) : null;
    if (!prev || !ctx) {
      toHub();
      return;
    }
    useIntakeDraftStore.getState().setView('member', { memberId: familyMemberId, step: prev });
    if (navigation.canGoBack()) navigation.goBack();
    else {
      const target = memberStepTarget(prev, familyMemberId, ctx.modules);
      navigation.replace(target.name, target.params as never);
    }
  };

  const finishLater = () => {
    useIntakeDraftStore.getState().setSkipped(familyMemberId, true);
    toHub();
  };

  return {
    ...info,
    steps,
    index: Math.max(1, steps.indexOf(step) + 1),
    total: Math.max(1, steps.length),
    score,
    saving,
    error,
    next,
    back,
    finishLater,
  };
}
