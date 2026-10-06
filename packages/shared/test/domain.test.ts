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
