import {
  targetForKind,
  targetForNotification,
  targetForRoute,
} from '../utils/notification-routing';

const MEMBER = '44444444-4444-4444-8444-444444444444';

describe('Sprint 6 notification routing', () => {
  it('opens the Ramadan planner for the ramadan link only when the flag is on', () => {
    expect(targetForRoute('thuluth://ramadan')).toEqual({
      tab: 'MoreTab',
      screen: 'FastingTracker',
    });
    expect(targetForRoute('thuluth://ramadan', { ramadanPlanner: true })).toEqual({
      tab: 'MoreTab',
      screen: 'RamadanPlanner',
    });
    expect(
      targetForNotification(
        { kind: 'suhoor_reminder', data: { route: 'thuluth://ramadan' } },
        { ramadanPlanner: true },
      ),
    ).toEqual({ tab: 'MoreTab', screen: 'RamadanPlanner' });
  });

  it('routes the new screens', () => {
    expect(targetForRoute('thuluth://exports')).toEqual({ tab: 'MoreTab', screen: 'Exports' });
    expect(targetForRoute('thuluth://help')).toEqual({ tab: 'MoreTab', screen: 'HelpCenter' });
    expect(targetForRoute('thuluth://insights')).toEqual({
      tab: 'MoreTab',
      screen: 'NutritionInsights',
    });
    expect(targetForRoute('https://thuluth.app/settings/privacy')).toEqual({
      tab: 'MoreTab',
      screen: 'SettingsPrivacy',
    });
    expect(targetForRoute(`thuluth://growth/${MEMBER}`)).toEqual({
      tab: 'FamilyTab',
      screen: 'GrowthDashboard',
      params: { familyMemberId: MEMBER },
    });
    expect(targetForRoute('thuluth://growth/not-a-uuid')).toBeNull();
  });

  it('falls back by kind for growth, exposure and export pushes', () => {
    expect(targetForKind('growth_alert', { family_member_id: MEMBER })).toEqual({
      tab: 'FamilyTab',
      screen: 'GrowthDashboard',
      params: { familyMemberId: MEMBER },
    });
    expect(targetForKind('growth_measure_due', {})).toEqual({
      tab: 'FamilyTab',
      screen: 'FamilyManagement',
    });
    expect(targetForKind('exposure_nudge')).toEqual({
      tab: 'FamilyTab',
      screen: 'FamilyManagement',
    });
    expect(targetForNotification({ kind: 'export_ready', data: {} })).toEqual({
      tab: 'MoreTab',
      screen: 'Exports',
    });
  });
});
