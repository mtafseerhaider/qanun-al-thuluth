import enAuth from '@locales/en/auth.json';
import enCommon from '@locales/en/common.json';
import enDebug from '@locales/en/debug.json';
import enErrors from '@locales/en/errors.json';
import enFamily from '@locales/en/family.json';
import enHelp from '@locales/en/help.json';
import enHousehold from '@locales/en/household.json';
import enIntake from '@locales/en/intake.json';
import enKnowledge from '@locales/en/knowledge.json';
import enMeals from '@locales/en/meals.json';
import enNavigation from '@locales/en/navigation.json';
import enOnboarding from '@locales/en/onboarding.json';
import enPlan from '@locales/en/plan.json';
import enRecipes from '@locales/en/recipes.json';
import enSettings from '@locales/en/settings.json';
import enToday from '@locales/en/today.json';
import enHydration from '@locales/en/hydration.json';
import enFasting from '@locales/en/fasting.json';
import enGrocery from '@locales/en/grocery.json';
import enBudget from '@locales/en/budget.json';
import enNotifications from '@locales/en/notifications.json';
import enTracking from '@locales/en/tracking.json';
import urAuth from '@locales/ur/auth.json';
import urCommon from '@locales/ur/common.json';
import urDebug from '@locales/ur/debug.json';
import urErrors from '@locales/ur/errors.json';
import urFamily from '@locales/ur/family.json';
import urHelp from '@locales/ur/help.json';
import urHousehold from '@locales/ur/household.json';
import urIntake from '@locales/ur/intake.json';
import urKnowledge from '@locales/ur/knowledge.json';
import urMeals from '@locales/ur/meals.json';
import urNavigation from '@locales/ur/navigation.json';
import urOnboarding from '@locales/ur/onboarding.json';
import urPlan from '@locales/ur/plan.json';
import urRecipes from '@locales/ur/recipes.json';
import urSettings from '@locales/ur/settings.json';
import urToday from '@locales/ur/today.json';
import urHydration from '@locales/ur/hydration.json';
import urFasting from '@locales/ur/fasting.json';
import urGrocery from '@locales/ur/grocery.json';
import urBudget from '@locales/ur/budget.json';
import urNotifications from '@locales/ur/notifications.json';
import urTracking from '@locales/ur/tracking.json';
export const NAMESPACES = [
  'common',
  'auth',
  'onboarding',
  'navigation',
  'settings',
  'household',
  'family',
  'intake',
  'knowledge',
  'meals',
  'plan',
  'recipes',
  'today',
  'help',
  'errors',
  'debug',
  'hydration',
  'fasting',
  'grocery',
  'budget',
  'notifications',
  'tracking',
] as const;
export type Namespace = (typeof NAMESPACES)[number];

export const resources = {
  en: {
    common: enCommon,
    auth: enAuth,
    onboarding: enOnboarding,
    navigation: enNavigation,
    settings: enSettings,
    household: enHousehold,
    family: enFamily,
    intake: enIntake,
    knowledge: enKnowledge,
    meals: enMeals,
    plan: enPlan,
    recipes: enRecipes,
    today: enToday,
    help: enHelp,
    errors: enErrors,
    debug: enDebug,
    hydration: enHydration,
    fasting: enFasting,
    grocery: enGrocery,
    budget: enBudget,
    notifications: enNotifications,
    tracking: enTracking,
  },
  ur: {
    common: urCommon,
    auth: urAuth,
    onboarding: urOnboarding,
    navigation: urNavigation,
    settings: urSettings,
    household: urHousehold,
    family: urFamily,
    intake: urIntake,
    knowledge: urKnowledge,
    meals: urMeals,
    plan: urPlan,
    recipes: urRecipes,
    today: urToday,
    help: urHelp,
    errors: urErrors,
    debug: urDebug,
    hydration: urHydration,
    fasting: urFasting,
    grocery: urGrocery,
    budget: urBudget,
    notifications: urNotifications,
    tracking: urTracking,
  },
} as const;
