import { scan } from './text.ts';
import type { Pattern, PatternHit } from './text.ts';

/**
 * Cure-claim detector (00 §10.6, 12 §13.8): never claim a food, Sunnah food or narration cures,
 * heals, treats or prevents a disease. The copy rule is "In the tradition, X is valued; research
 * suggests ... (strength)" (13 §11).
 */
const CURE_PATTERNS: readonly Pattern[] = [
  {
    code: 'cure_claim',
    re: /\b(cures?|cured|curing|heals?|healed|treats?|prevents?|reverses?|eliminates?|gets rid of|a remedy for|remedy for|the cure for|miracle (food|cure))\b.{0,60}\b(disease|diabetes|cancer|illness|infection|blood pressure|hypertension|cholesterol|obesity|asthma|arthritis|depression|autism|adhd|anaemia|anemia)\b/i,
  },
  {
    code: 'cure_claim',
    re: /(\b(black seed|kalonji|honey|dates|talbina|zamzam|olive oil|barley|pomegranate|figs|vinegar|ajwa)\b|\[\[src:[a-z0-9_.]+\]\]).{0,60}\b(cures?|heals?|is a remedy|is the cure|is a cure|is a treatment)\b/i,
  },
  // Urdu: shifa or ilaj as a promise ("... کا علاج ہے", "... سے شفا ملتی ہے").
  {
    code: 'cure_claim',
    re: /(کا علاج ہے|سے شفا ملتی|شفا دیتا|شفا دیتی|ہر بیماری|ka ilaj hai|se shifa)/iu,
  },
];

export function findCureClaims(text: string): PatternHit[] {
  return scan(text, CURE_PATTERNS);
}
