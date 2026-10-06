/** The rule of thirds as the app encodes it (00-foundations §2). */
export const PLATE_SPLIT = { veg_fruit: 0.5, protein: 0.25, carb: 0.25 } as const;

/** Water 20 to 30 minutes before meals, sips during, freely 30 to 60 minutes after. */
export const FLUID_TIMING = {
  preMealMinutes: { min: 20, max: 30 },
  postMealMinutes: { min: 30, max: 60 },
} as const;

export const MEAL_DURATION_MINUTES = 20;

/** Adults stop at about 70 to 80 percent full. Never applied to anyone under 18. */
export const ADULT_STOP_POINT_PERCENT = { min: 70, max: 80 } as const;
