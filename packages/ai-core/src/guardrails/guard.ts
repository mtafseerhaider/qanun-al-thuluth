import { findChildRestrictionViolations } from './child-restriction.ts';
import type { ChildRestrictionContext } from './child-restriction.ts';
import { classifyInput, classifyOutputWithModel } from './classify.ts';
import type { Classified, ClassifyDeps } from './classify.ts';
import { findCureClaims } from './cure-claims.ts';
import { removeFeedingPressure } from './feeding-pressure.ts';
import { injectDisclaimer } from './disclaimer.ts';
import { findRulingAssertions, hasScholarReferral } from './fiqh.ts';
import {
  CHILD_GROWTH_FIRST,
  CURE_CLAIM_SAFE,
  emergencyTemplate,
  RED_FLAG_REFERRAL,
  SCHOLAR_REFERRAL,
} from './templates.ts';
import { sentences } from './text.ts';
import type { Locale, PatternHit } from './text.ts';

/**
 * Output guardrail module (12 §13.4-13.9). Deterministic validators run first and replace or
 * repair unsafe drafts with fixed templates; `classify.safety` reviews what passes as a second
 * layer. Safety flags use the `chat_messages.safety_flags` vocabulary.
 */

export interface GuardContext extends ChildRestrictionContext {
  locale: Locale;
  /** The draft is about or addressed to a member under 18 (by name, id or intent). */
  aboutMinor?: boolean | undefined;
  /** The user asked a fiqh question; the reply must refer to a scholar. */
  fiqhQuestion?: boolean | undefined;
  /** Append the clinician disclaimer when the text has health guidance (FR-AI-10). */
  disclaimer?: boolean | undefined;
}

export interface GuardResult {
  text: string;
  violations: PatternHit[];
  safetyFlags: string[];
  /** True when the draft was replaced by a template. */
  replaced: boolean;
}

/** Deterministic output validation and repair. Pure and synchronous. */
export function guardOutput(draft: string, ctx: GuardContext): GuardResult {
  const violations: PatternHit[] = [];
  const flags = new Set<string>();
  let text = draft;
  let replaced = false;

  if (ctx.aboutMinor) {
    const hits = findChildRestrictionViolations(text, ctx);
    if (hits.length) {
      violations.push(...hits);
      flags.add('child_restriction_blocked');
      text = CHILD_GROWTH_FIRST[ctx.locale];
      replaced = true;
    } else {
      // Division of Responsibility (15 §3.8, §4.2): pressure, bribes, rewards and hiding foods go.
      const pressure = removeFeedingPressure(text, ctx.locale);
      if (pressure.hits.length) {
        violations.push(...pressure.hits);
        flags.add('feeding_pressure_removed');
        text = pressure.text;
      }
    }
  }

  const rulings = findRulingAssertions(text);
  if (rulings.length) {
    violations.push(...rulings);
    flags.add('fatwa_blocked');
    text = SCHOLAR_REFERRAL[ctx.locale];
    replaced = true;
  } else if (ctx.fiqhQuestion && !hasScholarReferral(text)) {
    flags.add('scholar_referral_added');
    text = `${text.trimEnd()}\n\n${SCHOLAR_REFERRAL[ctx.locale]}`;
  }

  const cures = findCureClaims(text);
  if (cures.length) {
    violations.push(...cures);
    flags.add('cure_claim_removed');
    const kept = sentences(text).filter((s) => findCureClaims(s).length === 0);
    text = kept.length
      ? `${kept.join(' ')}\n\n${CURE_CLAIM_SAFE[ctx.locale]}`
      : CURE_CLAIM_SAFE[ctx.locale];
  }

  if (ctx.disclaimer) text = injectDisclaimer(text, ctx.locale);
  return { text, violations, safetyFlags: [...flags], replaced };
}

/** The instruction appended to the system prompt for a classified input (12 §13.1 diagram). */
export function instructionFor(c: Classified, locale: Locale): string | null {
  const parts: string[] = [];
  if (c.child_weight_request) {
    parts.push(
      'The user is asking about restricting a child. Never give a child a calorie number, a diet, a deficit, smaller portions or weight-loss advice. Explain warmly that growing children need enough food, offer family-wide habits, use the Division of Responsibility, and suggest the paediatrician.',
    );
  }
  if (c.fiqh_question) {
    parts.push(
      `The user is asking for a religious ruling. Do not state whether anything is halal, haram, permissible, obligatory, or whether a fast is valid. Say it is a question for a qualified scholar of their tradition and include the phrase "${locale === 'ur' ? 'براہِ کرم کسی مستند عالمِ دین سے پوچھیں' : 'please ask a qualified scholar'}". Help with the nutrition side only.`,
    );
  }
  if (locale === 'ur') parts.push('Reply in Urdu (Nastaliq script), in simple words.');
  return parts.length ? parts.join('\n') : null;
}

export interface GuardedTurnResult {
  text: string;
  classification: Classified;
  /** The model was not called: a fixed template answered (emergency or red flag). */
  bypassedModel: boolean;
  escalated: boolean;
  violations: PatternHit[];
  safetyFlags: string[];
}

/**
 * One guarded single-turn reply: classify the input (rules, then optionally the model), answer
 * emergencies and red flags with fixed templates without calling the main model, otherwise
 * generate with the safety instruction and validate the draft. Used by the eval suite; `ai-chat`
 * (Sprint 5) composes the same pieces with tools and streaming.
 */
export async function runGuardedTurn(args: {
  text: string;
  locale: Locale;
  countryCode?: string;
  generate: (instruction: string | null) => Promise<string>;
  classifyDeps?: ClassifyDeps;
  /** Run the `classify.output` model on drafts that pass the deterministic validators. */
  modelOutputCheck?: boolean;
}): Promise<GuardedTurnResult> {
  const classification = await classifyInput(args.text, args.classifyDeps);
  if (classification.safety === 'emergency') {
    return {
      text: emergencyTemplate(args.locale, args.countryCode),
      classification,
      bypassedModel: true,
      escalated: true,
      violations: [],
      safetyFlags: ['emergency_template'],
    };
  }
  if (classification.safety === 'red_flag' && !classification.child_weight_request) {
    const referral = RED_FLAG_REFERRAL[args.locale];
    return {
      text: classification.fiqh_question
        ? `${referral}\n\n${SCHOLAR_REFERRAL[args.locale]}`
        : referral,
      classification,
      bypassedModel: true,
      escalated: true,
      violations: [],
      safetyFlags: ['red_flag_referral'],
    };
  }

  const draft = await args.generate(instructionFor(classification, args.locale));
  const ctx: GuardContext = {
    locale: args.locale,
    aboutMinor: classification.child_weight_request,
    fiqhQuestion: classification.fiqh_question,
    disclaimer: true,
  };
  let guarded = guardOutput(draft, ctx);
  if (args.modelOutputCheck && args.classifyDeps && !guarded.replaced) {
    const review = await classifyOutputWithModel(guarded.text, args.classifyDeps);
    if (review && !review.pass) {
      const fallback = classification.child_weight_request
        ? CHILD_GROWTH_FIRST[args.locale]
        : classification.fiqh_question
          ? SCHOLAR_REFERRAL[args.locale]
          : RED_FLAG_REFERRAL[args.locale];
      guarded = {
        ...guardOutput(fallback, ctx),
        safetyFlags: [...guarded.safetyFlags, 'output_classifier_blocked'],
        replaced: true,
      };
    }
  }
  return {
    text: guarded.text,
    classification,
    bypassedModel: false,
    escalated: classification.safety === 'red_flag',
    violations: guarded.violations,
    safetyFlags: guarded.safetyFlags,
  };
}
