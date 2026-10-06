import { describe, expect, it } from 'vitest';

import { HouseholdInviteRequest } from '../src/contracts/household-invite.ts';
import { ConsentGrant } from '../src/domain/consent.ts';
import { FamilyMemberInput } from '../src/domain/family-member.ts';

describe('HouseholdInviteRequest', () => {
  it('normalizes the email and rejects coach invites', () => {
    const parsed = HouseholdInviteRequest.parse({
      action: 'create',
      household_id: '00000000-0000-4000-8000-000000000001',
      email: '  Uzma@Example.com ',
      role: 'caregiver',
    });
    expect(parsed.action === 'create' && parsed.email).toBe('uzma@example.com');
    expect(
      HouseholdInviteRequest.safeParse({
        action: 'create',
        household_id: '00000000-0000-4000-8000-000000000001',
        email: 'a@b.co',
        role: 'coach',
      }).success,
    ).toBe(false);
  });
});

describe('FamilyMemberInput', () => {
  it('applies defaults and rejects future birth dates', () => {
    const m = FamilyMemberInput.parse({ name: 'Eliyya', date_of_birth: '2022-05-01' });
    expect(m.sex_at_birth).toBe('unspecified');
    expect(m.special_modules).toEqual([]);
    expect(FamilyMemberInput.safeParse({ name: 'X', date_of_birth: '2999-01-01' }).success).toBe(
      false,
    );
  });
});

describe('ConsentGrant', () => {
  it('requires a household for child data', () => {
    expect(ConsentGrant.safeParse({ kind: 'child_data', version: 'v' }).success).toBe(false);
    expect(ConsentGrant.safeParse({ kind: 'terms', version: 'v' }).success).toBe(true);
  });
});

describe('intake', () => {
  it('blocks weight goals for minors and flags medications', async () => {
    const { disallowedGoalsForAge, medicationFlagsFor, SensoryProfileInput } =
      await import('../src/domain/intake.ts');
    expect(disallowedGoalsForAge(['weight_loss', 'energy', 'weight_gain'], 8)).toEqual([
      'weight_loss',
      'weight_gain',
    ]);
    expect(disallowedGoalsForAge(['weight_loss'], 37)).toEqual([]);
    expect(medicationFlagsFor('Lantus 10 units')).toEqual(['insulin']);
    expect(medicationFlagsFor('Ritalin LA')).toEqual(['stimulant_appetite_suppression']);
    expect(
      SensoryProfileInput.safeParse({ texture_likes: ['soft'], texture_avoids: ['soft'] }).success,
    ).toBe(false);
  });

  it('never returns kcal targets for children', async () => {
    const { MemberAssessment } = await import('../src/contracts/ai-intake-assess.ts');
    const base = {
      assessment_id: '00000000-0000-4000-8000-000000000001',
      family_member_id: '00000000-0000-4000-8000-000000000002',
      summary: 's',
      macro_targets: null,
      hydration_target_ml: 1600,
      risk_flags: [],
      escalation: null,
      recommendation_ids: [],
    };
    expect(
      MemberAssessment.safeParse({
        ...base,
        life_stage: 'child',
        energy_targets: { kcal_per_day: 1500, method: 'x' },
      }).success,
    ).toBe(false);
    expect(
      MemberAssessment.safeParse({ ...base, life_stage: 'child', energy_targets: null }).success,
    ).toBe(true);
  });
});
