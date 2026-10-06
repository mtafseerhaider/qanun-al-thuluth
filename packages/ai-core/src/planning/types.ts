import type { GoalType, LifeStage, Severity, SpecialModule } from '@thuluth/shared';

/**
 * Meal Planning Engine types (14-meal-planning-and-grocery.md §3, 12 §4.4). The engine is pure:
 * Edge Functions load these shapes from the database (05 column names) and pass them in.
 */

export type PlanMealType = 'suhoor' | 'breakfast' | 'lunch' | 'snack' | 'dinner' | 'iftar';
export type HalalStatus = 'halal' | 'haram' | 'mashbooh' | 'depends_on_source';
export type ReviewStatus = 'unverified' | 'in_review' | 'verified' | 'rejected';
export type PortionTier = 'standard' | 'start' | 'ideal' | 'extra';
export type AlternativeReason = 'allergy' | 'budget' | 'autism' | 'picky' | 'season' | 'preference';
export type Adaptation = 'none' | 'autism' | 'picky' | 'allergy' | 'pregnancy';
export type Availability = 'peak' | 'available' | 'scarce';
export type BudgetStrictness = 'flexible' | 'target' | 'hard_cap';

/** `ingredients` row plus its `ingredient_allergens` codes. */
export interface CatalogIngredient {
  id: string;
  name: string;
  /** `ingredients.category` (vegetable, fruit, grain, legume, meat, poultry, fish, egg, dairy, ...). */
  category: string;
  halalStatus: HalalStatus;
  allergenCodes: readonly string[];
  isSunnahFood: boolean;
  /** Medication-interaction tags; derived from the name when absent (see `interactionTagsFor`). */
  interactionTags?: readonly string[] | undefined;
}

/** `portions` row for a meal. */
export interface CatalogPortion {
  id: string;
  lifeStage: LifeStage;
  tier: PortionTier;
  grams: number;
  /** Stored for adults only; never exposed for minors. */
  kcal: number | null;
}

/** `meals` row with its recipe and side-component ingredients flattened. */
export interface CatalogMeal {
  id: string;
  /** `meals.code` (stable seed key, e.g. D001, D001-A); null for household or AI meals. */
  code: string | null;
  title: string;
  mealType: PlanMealType;
  /** Every ingredient in every component, optional ones included (allergen safety). */
  ingredientIds: readonly string[];
  plateSplit: { veg_fruit: number; protein: number; carb: number };
  /** Max of the component recipes' cost tiers. */
  costTier: 1 | 2 | 3;
  /** Max of the component recipes' prep + cook minutes. */
  prepMin: number;
  kidFriendly: boolean;
  autismFriendly: boolean;
  portions: readonly CatalogPortion[];
  /** `meal_alternatives` rows where this meal is `meal_id`. */
  alternatives: ReadonlyArray<{ mealId: string; reason: AlternativeReason }>;
  householdId: string | null;
  source: 'curated' | 'ai_generated' | 'user';
  /** Least-reviewed status among the meal and its recipes. */
  reviewStatus: ReviewStatus;
}

export interface Catalog {
  meals: ReadonlyMap<string, CatalogMeal>;
  ingredients: ReadonlyMap<string, CatalogIngredient>;
}

export interface MemberAllergy {
  allergenCode: string;
  severity: Severity;
  kind: 'allergy' | 'intolerance';
}

export interface SafeFood {
  /** `food_preferences.id`. */
  id: string;
  ingredientId: string | null;
  label: string;
  strength: number;
}

export interface PlanMember {
  id: string;
  /** Display name, used only in serving notes; never sent to a model. */
  name: string;
  ageMonths: number;
  lifeStage: LifeStage;
  allergies: readonly MemberAllergy[];
  dislikes: ReadonlyArray<{
    ingredientId: string | null;
    label: string;
    reason: 'taste' | 'texture' | 'smell' | 'color' | 'religious' | 'other';
  }>;
  likes: ReadonlyArray<{ ingredientId: string | null; label: string; strength: number }>;
  safeFoods: readonly SafeFood[];
  modules: readonly SpecialModule[];
  /** `medications.food_interaction_flags`, flattened. */
  medicationFlags: readonly string[];
  goals: readonly GoalType[];
  /** Adult assessment target (display target); null for minors and when unknown. */
  energyTargetKcal: number | null;
}

export interface PlanHousehold {
  id: string;
  allowMashbooh: boolean;
  weekdayCookLimitMin: number;
  weekendCookLimitMin: number;
  /** 1 (tight) .. 3 (comfortable); null = no budget profile. */
  budgetTier: 1 | 2 | 3 | null;
  budgetStrictness: BudgetStrictness | null;
  /** Ingredient id → availability for the plan month in the household region. */
  seasonal: ReadonlyMap<string, Availability>;
  /** `catalog.include_in_review` (non-production only): in_review meals are usable. */
  includeInReview: boolean;
  /**
   * Severe or anaphylactic allergen codes of every active household member, including members not
   * served by this plan (cross-contact: 14 §8.3 rule 3).
   */
  severeAllergenCodes?: readonly string[] | undefined;
}

export interface PlanRequest {
  startDate: string;
  weekCount: number;
  mealTypes: readonly PlanMealType[];
  kind: 'standard' | 'growth' | 'weight_management' | 'custom';
  members: readonly PlanMember[];
  household: PlanHousehold;
  /** Ingredients excluded for this plan (adjustments, brief). */
  avoidIngredientIds?: readonly string[] | undefined;
  preferredIngredientIds?: readonly string[] | undefined;
  maxPrepMinWeekday?: number | undefined;
  repeatTolerance?: 'low' | 'medium' | 'high' | undefined;
  sunnahEmphasis?: boolean | undefined;
  /** Prefer cheaper meals (adjustment "cheaper please"). */
  cheaper?: boolean | undefined;
  /** Prefer meals with a smaller carb share for adults (adjustment "less rice"). */
  lighterCarbs?: boolean | undefined;
  /** Deterministic tie-breaking. */
  seed: number;
}

export interface Slot {
  /** Stable short ref used in model prompts: s1, s2, ... */
  ref: string;
  date: string;
  /** 1-based week of the plan. */
  week: number;
  /** 0 = Sunday .. 6 = Saturday. */
  weekday: number;
  mealType: PlanMealType;
}

export interface Candidate {
  /** c1..ck within the slot. */
  ref: string;
  mealId: string;
  score: number;
  reasons: string[];
}

export interface CandidateSet {
  slot: Slot;
  candidates: Candidate[];
  /** Soft constraints relaxed to find any candidate (prep limit, plate split never). */
  relaxed: string[];
}

export interface PlannedServing {
  memberId: string;
  portionId: string;
  portionTier: PortionTier;
  lifeStage: LifeStage;
  adaptation: Adaptation;
  adaptedMealId: string | null;
  safeFood: SafeFood | null;
  /** Weight goal handling applied to this serving; always 'none' for minors and pregnancy. */
  goalApplied: 'none' | 'weight_loss';
}

export interface PlannedMeal {
  slot: Slot;
  mealId: string;
  notes: string | null;
  servings: PlannedServing[];
}

export interface DraftPlan {
  meals: PlannedMeal[];
  /** Members with no servings (infants), with the reason. */
  skippedMembers: Array<{ memberId: string; reason: 'infant' }>;
  warnings: Violation[];
}

export interface Violation {
  code: string;
  message: string;
  /** Hard violations fail the plan; soft ones are warnings. */
  hard: boolean;
  slotRef?: string | undefined;
  memberId?: string | undefined;
}

export class PlanningError extends Error {
  readonly code: 'NO_CANDIDATES' | 'NO_MEMBERS';
  readonly slotRef: string | undefined;
  constructor(code: PlanningError['code'], message: string, slotRef?: string) {
    super(message);
    this.name = 'PlanningError';
    this.code = code;
    this.slotRef = slotRef;
  }
}
