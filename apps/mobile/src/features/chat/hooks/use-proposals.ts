import { useNavigation } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { useCallback } from 'react';

import { hijriIso, toHijri } from '@shared/prayer/hijri';

import { useFamilyMembers } from '@/features/family';
import { logFast } from '@/features/fasting';
import { logHydration } from '@/features/hydration';
import { logMealLog, memberAge } from '@/features/meal-log';
import { activateMealPlan, useHouseholdClock } from '@/features/meals';
import { track } from '@/lib/analytics/track';
import { addDays } from '@/lib/dates/local-date';
import { qk } from '@/lib/query/query-keys';
import { isAppError } from '@/lib/supabase/app-error';

import { applyPlanAdjustment } from '../api/chat-api';
import type { ChatProposal, ProposalStatus } from '../utils/chat-stream';
import { guardForMember, proposalAction, type ProposalAction } from '../utils/proposal-rules';

type ActionKind = Exclude<ProposalAction['kind'], 'unsupported'>;

/**
 * Runs a proposal only after the user tapped Confirm (FR-CHAT-06). Log proposals are queued in the
 * outbox (offline-safe, idempotent by client id) with the child rules applied; plan adjustments go
 * through `ai-adjust-plan` and need a connection.
 */
export function useProposalActions(householdId: string | null) {
  const qc = useQueryClient();
  const navigation = useNavigation();
  const members = useFamilyMembers(householdId);
  const clock = useHouseholdClock(householdId);

  const actionFor = useCallback(
    (p: ChatProposal): ProposalAction => {
      const action = proposalAction(p.card);
      if (action.kind === 'unsupported' || action.kind === 'plan_adjust') return action;
      const m = (members.data ?? []).find((x) => x.id === action.memberId);
      return guardForMember(action, m ? memberAge(m, clock.today) : null);
    },
    [members.data, clock.today],
  );

  const memberName = useCallback(
    (id: string) => (members.data ?? []).find((m) => m.id === id)?.name ?? '',
    [members.data],
  );

  const confirm = useCallback(
    async (
      p: ChatProposal,
      setStatus: (status: ProposalStatus, code?: string) => void,
    ): Promise<void> => {
      if (!householdId || p.status !== 'pending') return;
      const action = actionFor(p);
      if (action.kind === 'unsupported') return;
      const kind: ActionKind = action.kind;
      setStatus('applying');
      try {
        switch (action.kind) {
          case 'hydration':
            logHydration({
              householdId,
              memberIds: [action.memberId],
              volumeMl: action.volumeMl,
              beverage: action.beverage,
              ...(action.timing ? { timing: action.timing } : {}),
              nowMinutes: clock.nowMinutes,
              ...(action.at ? { at: new Date(action.at) } : {}),
            });
            break;
          case 'meal_log':
            logMealLog(
              {
                householdId,
                familyMemberId: action.memberId,
                eatenAt: action.eatenAt ?? new Date().toISOString(),
                mealType: action.mealType,
                description: action.description,
                photoPath: null,
                estimatedNutrition: {},
                fullnessBefore: action.fullnessBefore,
                fullnessAfter: action.fullnessAfter,
                source: 'manual',
                loggedByUserId: null,
              },
              'chat',
            );
            break;
          case 'fast':
            logFast({
              id: Crypto.randomUUID(),
              householdId,
              familyMemberId: action.memberId,
              fastDate: action.fastDate,
              kind: action.fastKind,
              startedAt: null,
              endedAt: null,
              completed: action.completed,
              exemptionReason: null,
              isPracticeFast: action.practice,
              notes: null,
              hijriDate: hijriIso(toHijri(action.fastDate)),
              qadaForHijriYear: null,
            });
            break;
          case 'plan_adjust': {
            const res = await applyPlanAdjustment({
              mealPlanId: action.mealPlanId,
              changeRequest: action.changeRequest,
              fromDate: clock.today,
              toDate: addDays(clock.today, 6),
              idempotencyKey: p.id,
            });
            if (res.kind === 'completed' && res.mealPlanId) await activateMealPlan(res.mealPlanId);
            void qc.invalidateQueries({ queryKey: qk.household(householdId).mealPlans() });
            void qc.invalidateQueries({ queryKey: qk.household(householdId).dailyMeals() });
            if (res.kind === 'accepted' && res.mealPlanId)
              navigation.navigate('PlanGenerationProgress', { mealPlanId: res.mealPlanId });
            break;
          }
        }
        setStatus('applied');
        track('chat_proposal_resolved', { kind, action: 'confirmed' });
      } catch (e) {
        const code = isAppError(e) ? e.code : 'UNKNOWN';
        setStatus('failed', code);
        track('chat_proposal_resolved', { kind, action: 'failed' });
        if (code === 'PREMIUM_REQUIRED')
          navigation.navigate('PaywallModal', { trigger: 'plan_adjust' });
      }
    },
    [actionFor, clock.nowMinutes, clock.today, householdId, navigation, qc],
  );

  const dismiss = useCallback(
    (p: ChatProposal, setStatus: (status: ProposalStatus) => void) => {
      setStatus('dismissed');
      const action = actionFor(p);
      if (action.kind !== 'unsupported')
        track('chat_proposal_resolved', { kind: action.kind, action: 'dismissed' });
    },
    [actionFor],
  );

  return { actionFor, memberName, confirm, dismiss };
}
