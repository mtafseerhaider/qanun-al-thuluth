-- supabase/seed/catalog/130_coaching_tips.sql
-- Content load v1: coaching tips (S6-07, FR-AUT-07, FR-PCK-01; 05 section 19 order 12; 15 sections 3 and 4).
-- 40 tips: picky 12, autism 10, ramadan 8, general 10, each with an age band in months. Idempotent:
-- `on conflict (code) do nothing`, so a re-run never overwrites a reviewed row.
--
-- NOT REVIEWED. Every row is inserted 'unverified' and users see none of them (RLS: active AND verified only). The
-- publishing gate (private.enforce_coaching_tip_rules) also needs an Urdu text and a non-retracted evidence row.
-- Before publishing: a paediatric dietitian (picky, general), a feeding therapist or clinician familiar with autism
-- (autism), and a clinician (Ramadan rows about fasting children, pregnancy and diabetes) must read each tip, and
-- the Urdu copy editor supplies 'ur'.
--
-- Rules followed:
--   * Each tip links ONLY to a scientific_evidence row already seeded in 110 (by code). No new citation, hadith or
--     Qur'an reference was written; Ramadan tips carry no Islamic claim (the Islamic framing lives in the verified
--     recommendations, 125).
--   * Child rules (00 section 10): no calories, kcal, weight targets or weight-loss talk in any tip that reaches under
--     18s (enforced by CHILD_RULE:calorie_content); no fasting under 7; practice fasts for 7 to puberty are partial
--     and the family's choice; pregnancy, breastfeeding and diabetes fasting decisions are deferred to the clinician.
--   * Autism tips: no autism-specific evidence row exists in 110 yet. They link to the general feeding evidence
--     (repeated exposure, no pressure, responsive feeding, division of responsibility). The content reviewer should
--     add autism-specific evidence (food chaining, sensory-based feeding) through knowledge:validate before publishing.
--   * English only, plain language, no cure or medical claims.

insert into public.coaching_tips (code, module, age_min_months, age_max_months, body_i18n, evidence_id, is_active, review_status)
select v.code, v.module, v.age_min, v.age_max, jsonb_build_object('en', v.body), e.id, true, 'unverified'
from (values
  -- picky (12) ------------------------------------------------------------------------------------------------------------
  ('tip.picky.small_taste_daily', 'picky', 24, 72,
   'Offer one small taste of the new food every day for about two weeks. A pea-sized piece is enough; liking often grows with repetition.',
   'sci.repeated_exposure.wardle_2003'),
  ('tip.picky.many_tries', 'picky', 12, 144,
   'It can take ten or more tries before a child accepts a new food. Count each time the food is on the plate as progress, even if it is not eaten.',
   'sci.exposure_review.cooke_2007'),
  ('tip.picky.no_pressure', 'picky', 24, 144,
   'Skip "one more bite" and "finish your plate". Pressure tends to make children eat less of the food and enjoy the meal less.',
   'sci.pressure_to_eat.galloway_2006'),
  ('tip.picky.your_job_their_job', 'picky', 12, 216,
   'You decide what, when and where food is served; your child decides whether and how much to eat from what is offered.',
   'sci.division_of_responsibility.satter'),
  ('tip.picky.safe_food_on_plate', 'picky', 12, 144,
   'Put one food your child already eats on every plate next to the new food, so the meal never feels like a test.',
   'sci.division_of_responsibility.satter'),
  ('tip.picky.toddler_familiar', 'picky', 12, 36,
   'Toddlers prefer what they have seen before. Serve new fruits and cheeses again and again in small amounts; familiarity builds preference.',
   'sci.exposure_toddlers.birch_1982'),
  ('tip.picky.eat_together', 'picky', 24, 216,
   'Eat together as a family when you can. Children copy what they see adults enjoying at the dastarkhwan or table.',
   'sci.family_meals.hammons_2011'),
  ('tip.picky.no_rewards_with_sweets', 'picky', 24, 144,
   'Avoid trading dessert for vegetables. Rewards can make the vegetable seem like a chore and the sweet more special.',
   'sci.repeated_exposure.wardle_2003'),
  ('tip.picky.neutral_words', 'picky', 24, 144,
   'Describe food by colour, crunch and smell rather than "good" or "healthy". Neutral words keep the table calm.',
   'sci.exposure_review.cooke_2007'),
  ('tip.picky.cook_together', 'picky', 36, 216,
   'Let your child wash, stir or tear vegetables while you cook. Handling a food is a step towards tasting it.',
   'sci.exposure_review.cooke_2007'),
  ('tip.picky.set_meal_times', 'picky', 12, 144,
   'Keep regular meal and snack times and offer only water between them, so your child comes to the table ready to eat.',
   'sci.division_of_responsibility.satter'),
  ('tip.picky.teen_choice', 'picky', 144, 216,
   'With teenagers, offer choices within the family meal and invite them to plan one dinner a week. Control without pressure works better than rules.',
   'sci.pressure_to_eat.galloway_2006'),
  -- autism (10) -----------------------------------------------------------------------------------------------------------
  ('tip.autism.tiny_steps', 'autism', 24, 216,
   'Break a new food into tiny steps: on the table, look, touch, smell, lick, taste. Stay at a step until it feels calm before moving on.',
   'sci.exposure_review.cooke_2007'),
  ('tip.autism.keep_safe_foods', 'autism', 12, 216,
   'Always keep at least one safe food at each meal. Safe foods give your child energy and confidence while new foods are explored.',
   'sci.division_of_responsibility.satter'),
  ('tip.autism.one_change', 'autism', 24, 216,
   'Change one thing at a time: the same food with a new shape, or a new brand of a liked food. Small differences are easier to accept.',
   'sci.repeated_exposure.wardle_2003'),
  ('tip.autism.calm_exit', 'autism', 24, 216,
   'Agree on a calm way to say "no thank you", such as moving the food to a side plate. Knowing they can refuse lowers worry at meals.',
   'sci.pressure_to_eat.galloway_2006'),
  ('tip.autism.first_then', 'autism', 24, 144,
   'Use a simple "first, then" card at meals, for example "first look at the carrot, then rice". Visual steps make the meal predictable.',
   'sci.exposure_review.cooke_2007'),
  ('tip.autism.watch_cues', 'autism', 12, 72,
   'Watch for signs your child is full or overwhelmed, such as turning away or pushing the plate, and stop without fuss.',
   'sci.responsive_feeding.paho_who_2003'),
  ('tip.autism.quiet_table', 'autism', 12, 216,
   'Reduce noise, bright light and screens at the table if your child is sensitive to them. A quieter meal leaves more attention for food.',
   'sci.responsive_feeding.paho_who_2003'),
  ('tip.autism.same_plate_routine', 'autism', 24, 216,
   'Serve meals at the same place, with the same plate or cup if that helps. Routine around the food makes a new food on the plate less of a surprise.',
   'sci.division_of_responsibility.satter'),
  ('tip.autism.play_with_food', 'autism', 24, 120,
   'Food play away from mealtimes counts: stamping shapes in roti dough or sorting dal grains lets your child get used to textures without pressure to eat.',
   'sci.exposure_review.cooke_2007'),
  ('tip.autism.log_patterns', 'autism', 24, 216,
   'Log each exposure and how it went. Patterns over weeks, not single meals, show you which steps are working.',
   'sci.repeated_exposure.wardle_2003'),
  -- ramadan (8) -----------------------------------------------------------------------------------------------------------
  ('tip.ramadan.under7_family_ritual', 'ramadan', 24, 83,
   'Children under 7 do not fast. Let them join suhoor or iftar as a family ritual, with their normal meals and snacks through the day.',
   'sci.dietary_guidelines.usda_2020'),
  ('tip.ramadan.practice_fast_partial', 'ramadan', 84, 156,
   'If your child wants to practise, a part-day fast until Dhuhr or Asr on a few days is enough. Offer water and food whenever they ask to stop.',
   'sci.water_needs.efsa_2010'),
  ('tip.ramadan.child_water_after_iftar', 'ramadan', 84, 216,
   'Between iftar and suhoor, offer water little and often rather than a lot at once, so fasting children start the next day well hydrated.',
   'sci.water_needs.efsa_2010'),
  ('tip.ramadan.dates_and_water', 'ramadan', 84, 1200,
   'Open the fast with a few dates and water, then pause before the main meal. Dates give quick energy, fibre and potassium.',
   'sci.dates_composition.alfarsi_2008'),
  ('tip.ramadan.less_salt_suhoor', 'ramadan', 84, 1200,
   'Go easy on salty foods like pickles and salted snacks at suhoor; they make thirst harder during the fast.',
   'sci.sodium.who_2012'),
  ('tip.ramadan.wholegrain_suhoor', 'ramadan', 84, 1200,
   'Choose whole grains at suhoor, such as daliya, oats or whole-wheat roti, with yogurt or eggs, for steadier energy through the morning.',
   'sci.fibre_intake.reynolds_2019'),
  ('tip.ramadan.diabetes_check', 'ramadan', 216, 1200,
   'If anyone in the family has diabetes, especially on insulin or tablets that can cause low sugar, they should see their clinician before Ramadan to decide whether and how to fast.',
   'sci.diabetes_ramadan.idf_dar_2021'),
  ('tip.ramadan.weight_returns', 'ramadan', 216, 1200,
   'Weight lost during Ramadan usually returns within weeks. Aim for steady, balanced iftar and suhoor meals rather than using the month to diet.',
   'sci.ramadan_body_comp.fernando_2019'),
  -- general (10) ----------------------------------------------------------------------------------------------------------
  ('tip.general.no_honey_infants', 'general', 0, 11,
   'Do not give honey to babies under 12 months, not even a little on a dummy or in cooking. It can cause infant botulism.',
   'sci.infant_botulism.honey'),
  ('tip.general.responsive_feeding', 'general', 6, 24,
   'Feed your baby slowly and patiently, watch for hunger and fullness signs, and let them stop when they turn away.',
   'sci.responsive_feeding.paho_who_2003'),
  ('tip.general.no_added_sugar_under2', 'general', 0, 23,
   'Avoid added sugar before age 2. Sweeten porridge with mashed banana or dates instead of sugar or honey (no honey before 12 months).',
   'sci.dietary_guidelines.usda_2020'),
  ('tip.general.water_over_juice', 'general', 12, 1200,
   'Offer water as the main drink and whole fruit instead of juice. Juice counts as free sugar.',
   'sci.free_sugars.who_2015'),
  ('tip.general.tea_away_from_meals', 'general', 216, 1200,
   'Drink chai between meals rather than with them; tea taken with a meal reduces the iron absorbed from daal, greens and grains.',
   'sci.tea_iron.hurrell_1999'),
  ('tip.general.eat_slowly', 'general', 216, 1200,
   'Put the roti down between bites and eat slowly. Slower meals help you notice when you are comfortably full.',
   'sci.eating_rate.robinson_2014'),
  ('tip.general.dairy_for_bones', 'general', 12, 1200,
   'Include milk, yogurt or lassi each day for calcium. Growing children and teenagers need it for strong bones.',
   'sci.dairy_calcium.iom_2011'),
  ('tip.general.plan_leftovers', 'general', 0, 1200,
   'Plan one leftovers meal a week and store cooked food in the fridge within two hours. It saves money and reduces waste.',
   'sci.food_waste.fao_2019'),
  ('tip.general.less_salt_cooking', 'general', 12, 1200,
   'Add salt at the end of cooking and taste first. Children need less salt than adults; keep the shaker off the table.',
   'sci.sodium.who_2012'),
  ('tip.general.growth_check', 'general', 0, 228,
   'Measure height and weight at the intervals your app suggests. Growth is judged by the pattern over time against WHO charts, not one reading.',
   'sci.growth_standards.who_2006')
) as v(code, module, age_min, age_max, body, evidence_code)
join public.scientific_evidence e on e.code = v.evidence_code
on conflict (code) do nothing;
