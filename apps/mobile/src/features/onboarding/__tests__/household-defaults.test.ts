import {
  householdDefaults,
  parseBudget,
  validateHouseholdDraft,
} from '../utils/household-defaults';

describe('householdDefaults', () => {
  it('defaults to Pakistan with PKR and Asia/Karachi', () => {
    expect(householdDefaults({})).toEqual({
      country_code: 'PK',
      currency: 'PKR',
      timezone: 'Asia/Karachi',
    });
    expect(householdDefaults({ regionCode: 'PK', timeZone: 'Europe/London' }).timezone).toBe(
      'Asia/Karachi',
    );
  });

  it('follows a supported device region and its time zone', () => {
    expect(householdDefaults({ regionCode: 'GB', timeZone: 'Europe/London' })).toEqual({
      country_code: 'GB',
      currency: 'GBP',
      timezone: 'Europe/London',
    });
  });
});

describe('parseBudget', () => {
  it('stores budgets in minor units', () => {
    expect(parseBudget('45,000', 'PKR')).toBe(4_500_000);
    expect(parseBudget('', 'PKR')).toBeNull();
    expect(parseBudget('-5', 'PKR')).toBe('invalid');
    expect(parseBudget('lots', 'PKR')).toBe('invalid');
  });
});

it('validates the household draft', () => {
  expect(
    validateHouseholdDraft({
      name: '',
      city: 'x'.repeat(61),
      timezone: 'Mars/Olympus',
      currency: 'PKR',
      budgetMajor: 'abc',
    }),
  ).toEqual({
    name: 'nameRequired',
    city: 'cityTooLong',
    timezone: 'timezoneInvalid',
    budget: 'budgetInvalid',
  });
});
