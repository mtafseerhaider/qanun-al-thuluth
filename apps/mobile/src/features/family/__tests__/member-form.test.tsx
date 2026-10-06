import { fireEvent, screen } from '@testing-library/react-native';

import { renderWithProviders } from '@/test/render';

import { MemberForm } from '../components/member-form';
import {
  dobFromParts,
  emptyMemberForm,
  memberFraming,
  validateMemberForm,
  type MemberFormValues,
} from '../utils/member-form';

const TODAY = '2026-10-06';
const form = (patch: Partial<MemberFormValues>): MemberFormValues => ({
  ...emptyMemberForm,
  name: 'Amina',
  dobDay: '14',
  dobMonth: '3',
  dobYear: '1990',
  ...patch,
});

describe('dobFromParts', () => {
  it('builds ISO dates and rejects impossible ones', async () => {
    expect(dobFromParts('5', '7', '2019')).toBe('2019-07-05');
    expect(dobFromParts('31', '2', '2020')).toBeNull();
    expect(dobFromParts('1', '1', '20')).toBeNull();
  });
});

describe('validateMemberForm', () => {
  const opts = {
    units: 'metric' as const,
    today: TODAY,
    linkedUserId: '00000000-0000-4000-8000-000000000001',
  };

  it('accepts an adult and links them when "This is me" is ticked', async () => {
    const r = validateMemberForm(form({ height: '162', weight: '61.5', isMe: true }), opts);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.input).toMatchObject({
      name: 'Amina',
      date_of_birth: '1990-03-14',
      height_cm: 162,
      weight_kg: 61.5,
      linked_user_id: '00000000-0000-4000-8000-000000000001',
    });
    expect(r.framing.lifeStage).toBe('adult');
  });

  it('reports field errors with translation keys', async () => {
    const r = validateMemberForm(
      form({ name: ' ', dobDay: '31', dobMonth: '2', height: '900', weight: 'abc' }),
      opts,
    );
    expect(r).toEqual({
      ok: false,
      errors: {
        name: 'nameRequired',
        dob: 'dobInvalid',
        height: 'heightRange',
        weight: 'weightRange',
      },
    });
    expect(validateMemberForm(form({ name: 'x'.repeat(61) }), opts)).toMatchObject({
      errors: { name: 'nameTooLong' },
    });
    expect(validateMemberForm(form({ dobYear: '2027' }), opts)).toMatchObject({
      errors: { dob: 'dobFuture' },
    });
    expect(validateMemberForm(form({ dobDay: '', dobMonth: '', dobYear: '' }), opts)).toMatchObject(
      { errors: { dob: 'dobRequired' } },
    );
  });

  it('converts imperial input to metric', async () => {
    const r = validateMemberForm(form({ height: '64', weight: '132' }), {
      ...opts,
      units: 'imperial',
    });
    expect(r.ok && r.input.height_cm).toBeCloseTo(162.6, 1);
    expect(r.ok && r.input.weight_kg).toBeCloseTo(59.87, 1);
  });

  it('never links a child to the account', async () => {
    expect(validateMemberForm(form({ dobYear: '2018', isMe: true }), opts)).toMatchObject({
      ok: false,
      errors: { dob: 'meMustBeAdult' },
    });
  });
});

describe('child framing', () => {
  it.each([
    ['2026-03-01', 'infant', false],
    ['2024-06-01', 'toddler', false],
    ['2018-01-01', 'child', true],
    ['2011-01-01', 'teen', true],
  ] as const)('%s is a %s with growth framing', (dob, stage, showActivity) => {
    const f = memberFraming(dob, TODAY);
    expect(f).toMatchObject({
      lifeStage: stage,
      minor: true,
      canBeMe: false,
      showActivity,
      weightHelperKey: 'weightHelperChild',
    });
  });

  it('adults get the adult helper and can be linked', async () => {
    expect(memberFraming('1990-01-01', TODAY)).toMatchObject({
      minor: false,
      canBeMe: true,
      weightHelperKey: 'weightHelperAdult',
    });
  });
});

describe('MemberForm', () => {
  // Restriction framing that must never be shown for a child (02 §1.1).
  const RESTRICTION =
    /calorie (target|goal|budget|limit)|weight[- ]loss|lose weight|deficit|diet plan|target weight/i;

  it('shows the life stage, growth note and child weight helper for a child, without restriction wording', async () => {
    await renderWithProviders(
      <MemberForm householdId="hh-1" source="intake" allowLinkSelf onSaved={jest.fn()} />,
    );
    await fireEvent.changeText(screen.getByTestId('member-form.name'), 'Zayd');
    await fireEvent.changeText(screen.getByTestId('member-form.dob-day'), '2');
    await fireEvent.changeText(screen.getByTestId('member-form.dob-month'), '9');
    await fireEvent.changeText(screen.getByTestId('member-form.dob-year'), '2019');

    expect(screen.getByTestId('member-form.life-stage')).toBeTruthy();
    expect(screen.getByText('Life stage: Child')).toBeTruthy();
    expect(screen.getByTestId('member-form.child-note')).toBeTruthy();
    expect(
      screen.getByText('Optional. Used only to check growth, never for dieting.'),
    ).toBeTruthy();
    expect(screen.queryByTestId('member-form.is-me')).toBeNull();

    const allText = JSON.stringify(screen.toJSON());
    expect(allText).not.toMatch(RESTRICTION);
  });

  it('shows validation errors when saving an empty form', async () => {
    await renderWithProviders(
      <MemberForm householdId="hh-1" source="intake" allowLinkSelf onSaved={jest.fn()} />,
    );
    await fireEvent.press(screen.getByTestId('member-form.save'));
    expect(screen.getByText('Please enter a name.')).toBeTruthy();
    expect(screen.getByText('Please enter a date of birth.')).toBeTruthy();
  });
});
