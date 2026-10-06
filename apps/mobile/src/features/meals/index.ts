export { MealDetailScreen } from './screens/meal-detail-screen';
export { SwapMealSheet } from './screens/swap-meal-sheet';
export { MealCard, type MealCardServing, type MealCardTag } from './components/meal-card';
export { MealServingsEditor } from './components/meal-servings-editor';
export { MealServingRow } from './components/meal-serving-row';
export { AcceptanceScorePicker } from './components/acceptance-score-picker';
export { ThuluthGuidance, type ThuluthGuidanceProps } from './components/thuluth-guidance';
export {
  AdaptationBadge,
  Badge,
  PlateMini,
  QueuedBadge,
  StatusGlyph,
} from './components/meal-badges';
export { MealPlateLegend } from './components/meal-plate-legend';
export { UndoBar, useUndo, UNDO_WINDOW_MS } from './components/undo-bar';
export {
  logEveryoneAte,
  logServing,
  registerMealOutboxHandlers,
  useDailyMeal,
  useDailyMeals,
  useHouseholdClock,
  useHouseholdPremium,
  useMemberLookup,
  usePendingServingWrites,
  type LogServingInput,
} from './hooks/use-meals';
export {
  activateMealPlan,
  type Adaptation,
  type DailyMealView,
  type MealSummary,
  type ServingView,
} from './api/meals-api';
export { localized } from './utils/meal-parsing';
export {
  cardServings,
  cardTags,
  isFullyLogged,
  isMainMeal,
  isMinorStage,
  loggedCount,
  pickNextMeal,
  portionLabel,
  sortMeals,
  type MemberLite,
} from './utils/meal-rules';
