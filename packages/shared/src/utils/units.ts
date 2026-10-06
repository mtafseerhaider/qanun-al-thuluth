const LB_PER_KG = 2.2046226218;
const CM_PER_IN = 2.54;
const ML_PER_FL_OZ = 29.5735295625;

export const kgToLb = (kg: number): number => kg * LB_PER_KG;
export const lbToKg = (lb: number): number => lb / LB_PER_KG;
export const cmToIn = (cm: number): number => cm / CM_PER_IN;
export const inToCm = (inches: number): number => inches * CM_PER_IN;
export const mlToFlOz = (ml: number): number => ml / ML_PER_FL_OZ;
export const flOzToMl = (flOz: number): number => flOz * ML_PER_FL_OZ;
