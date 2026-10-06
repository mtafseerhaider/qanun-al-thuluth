-- supabase/seed/catalog/125_ramadan_recommendations.sql
-- Content load v2: Ramadan recommendations (S5-16, FR-RAM-01; 15 sections 5.3 to 5.7, 13 section 10.3).
-- Same rules as 120_recommendations.sql. Idempotent (`on conflict (code) do nothing`, `where not exists`).
--
-- NOT REVIEWED. Every row is inserted 'unverified' and STAYS unverified: none of the linked Islamic sources
-- is scholar-verified yet (100_islamic_sources.sql), and neither the scholar nor the nutrition and clinical
-- reviewers have read this text. Users see none of these rows (RLS: verified only); the publishing gate would
-- reject them anyway. public.recommendation_completeness() lists what each row still needs.
--
-- Rules followed:
--   * Links go ONLY to sources already seeded in 100 (Qur'an and Sunni hadith, by code) and 110 (scientific
--     evidence, by code). No new hadith, no new Qur'an reference, no new citation was written here.
--   * Hadith are linked only for what 13 section 10.1 and 15 section 5.2 already attach to them (suhoor,
--     breaking the fast with dates and water, food for two, drinking in breaths). Where a link only frames the
--     practice it is 'context', not 'supports'.
--   * English only. No Urdu and no Arabic text was written; the Urdu copy editor and an Urdu-speaking reviewer
--     supply 'ur' (the publishing gate requires it).
--   * tradition_scope follows the linked sources (120 rule): a Qur'anic (shared) source gives
--     {shared,sunni,shia}; Sunni hadith only gives {sunni}. science_only rows carry no Islamic claim.
--   * No cure or medical claim. Fasting decisions for pregnancy, breastfeeding, diabetes and children are
--     deferred to the family's clinician and scholar (00 section 10, 15 sections 5.5 to 5.7). The stop-fasting
--     and diabetes rows need CLINICIAN review before publishing.
--   * applies_to.collections = ["ramadan"] and contexts = ["fasting"] so the Ramadan planner and tips view
--     (S5-10, S5-11) can select them.

insert into public.recommendations (code, title_i18n, practical_text_i18n, applies_to, contraindications,
                                    tradition_scope, science_only, review_status)
select v.code, jsonb_build_object('en', v.title), jsonb_build_object('en', v.body), v.applies::jsonb,
       v.contra::jsonb, v.scope::public.source_tradition[], v.science_only, 'unverified'
from (values
  ('rec.ramadan.suhoor_slow_release', 'Slow-release grains at suhoor',
   'Build suhoor around whole grains that digest slowly: oats or daliya, whole-wheat roti, barley talbina or daal-atta roti, rather than white bread or sugary cereals.',
   '{"contexts":["fasting"],"collections":["ramadan"]}', '{}', '{shared,sunni,shia}', false),
  ('rec.ramadan.suhoor_protein', 'Protein at suhoor',
   'Add a protein food to suhoor, such as eggs, yogurt, daal or chana, alongside the grain. For teens who fast, keep suhoor portions at their normal growing size; never reduce them.',
   '{"contexts":["fasting"],"collections":["ramadan"]}', '{}', '{shared,sunni,shia}', false),
  ('rec.ramadan.suhoor_fluids', 'Spread fluids across suhoor',
   'Drink two to three glasses of water or milk spread across the suhoor meal instead of a large amount at once just before Fajr.',
   '{"contexts":["fasting"],"collections":["ramadan"]}', '{}', '{shared,sunni,shia}', false),
  ('rec.ramadan.suhoor_low_salt', 'Go easy on salt at suhoor',
   'Keep suhoor moderate in salt: fewer pickles (achaar), salty snacks and very salty parathas, so the day ahead is less thirsty.',
   '{"contexts":["fasting"],"collections":["ramadan"]}', '{}', '{shared,sunni,shia}', false),
  ('rec.ramadan.suhoor_water_rich_foods', 'Water-rich foods at suhoor',
   'Include water-rich foods at suhoor, such as cucumber, yogurt or raita, and seasonal fruit like melon or oranges. Food provides part of the day''s water.',
   '{"contexts":["fasting"],"collections":["ramadan"]}', '{}', '{shared,sunni,shia}', false),
  ('rec.ramadan.iftar_pause', 'Open, pray, then eat',
   'Open the fast with dates and water, pray Maghrib, and start the main meal about 20 to 30 minutes later, eating slowly.',
   '{"contexts":["fasting"],"collections":["ramadan"]}', '{}', '{sunni}', false),
  ('rec.ramadan.iftar_soup_first', 'Soup or salad first at iftar',
   'Start the main iftar meal with a bowl of light soup or yakhni, or a salad, then move on to the rest of the plate.',
   '{"contexts":["fasting"],"collections":["ramadan"]}', '{}', '{shared,sunni,shia}', false),
  ('rec.ramadan.iftar_normal_portion', 'A normal dinner portion at iftar',
   'Iftar is a normal dinner, not a meal to make up for the day: serve the usual plate with half vegetables and fruit, and stop when comfortably satisfied. This applies to adults; children eat to their appetite.',
   '{"contexts":["fasting"],"collections":["ramadan"],"life_stages":["adult","older_adult"]}', '{"modules":["eating_concern"]}', '{shared,sunni,shia}', false),
  ('rec.ramadan.fried_limit', 'Pakoras and samosas as a treat',
   'Keep fried iftar items such as pakoras and samosas to one small portion a week, and try baked or air-fried versions on other days.',
   '{"contexts":["fasting"],"collections":["ramadan"]}', '{}', '{shared,sunni,shia}', false),
  ('rec.ramadan.sweet_drinks', 'Water before sweet drinks',
   'Make water the main iftar drink. Keep sweet sherbets and sugary drinks to one small glass, or dilute them well.',
   '{"contexts":["fasting"],"collections":["ramadan"]}', '{}', '{shared,sunni,shia}', false),
  ('rec.ramadan.hydration_spread', 'Spread water from iftar to suhoor',
   'Spread water through the evening in glasses spaced about an hour apart: at iftar, after Maghrib, around Taraweeh, before sleep and at suhoor, instead of drinking a lot at once.',
   '{"contexts":["fasting"],"collections":["ramadan"]}', '{}', '{shared,sunni,shia}', false),
  ('rec.ramadan.chai_timing', 'Chai after the meal, not with it',
   'If you have chai in Ramadan, keep it to about two cups between iftar and suhoor, have it an hour after the meal rather than with it, and drink water as well.',
   '{"contexts":["fasting"],"collections":["ramadan"],"life_stages":["teen","adult","older_adult"]}', '{}', '{shared,sunni,shia}', true),
  ('rec.ramadan.taraweeh_snack', 'A light snack after Taraweeh',
   'After Taraweeh, if hungry, choose something light such as fruit, a glass of milk or a bowl of yogurt.',
   '{"contexts":["fasting"],"collections":["ramadan"]}', '{}', '{shared,sunni,shia}', false),
  ('rec.ramadan.dates_diabetes', 'Dates with diabetes',
   'If you have diabetes, count iftar dates in the carbohydrate plan agreed with your clinician, usually one to two, and follow the glucose checks they advise.',
   '{"contexts":["fasting"],"collections":["ramadan"],"conditions":["diabetes"]}', '{}', '{shared,sunni,shia}', false),
  ('rec.ramadan.diabetes_pre_ramadan', 'See your clinician before Ramadan',
   'If you have diabetes, especially on insulin or tablets such as gliclazide or glimepiride, see your clinician six to eight weeks before Ramadan to decide together whether and how to fast. The app does not make this decision.',
   '{"contexts":["fasting"],"collections":["ramadan"],"conditions":["diabetes"]}', '{}', '{shared,sunni,shia}', false),
  ('rec.ramadan.stop_signs', 'When to stop a fast',
   'Break the fast, drink water and seek medical help if you feel faint or confused, have a severe headache, cannot keep fluids down or pass very little dark urine. Allah intends ease.',
   '{"contexts":["fasting"],"collections":["ramadan"]}', '{}', '{shared,sunni,shia}', false),
  ('rec.ramadan.pregnancy_breastfeeding', 'Pregnancy, breastfeeding and fasting',
   'Whether to fast in pregnancy or while breastfeeding is decided with your clinician and a scholar you trust; the app supports either choice. If you fast, do not cut food: keep a protein-rich suhoor, eat a third meal after Taraweeh, and drink more between iftar and suhoor.',
   '{"contexts":["fasting"],"collections":["ramadan"],"modules":["pregnancy","breastfeeding"]}', '{}', '{shared,sunni,shia}', false),
  ('rec.ramadan.children_suhoor', 'Suhoor for children on practice fasts',
   'A child aged 7 or older on a practice fast always eats suhoor, with normal portions. Offer water and food straight away if they feel dizzy, unusually tired or upset.',
   '{"contexts":["fasting"],"collections":["ramadan"],"life_stages":["child","teen"],"min_age_months":84}', '{}', '{shared,sunni,shia}', false),
  ('rec.ramadan.under7_rituals', 'Little ones join without fasting',
   'Children under 7 do not fast. They can join Ramadan by opening with a date at iftar, helping set the table and keeping a good-deeds chart, while eating their normal meals.',
   '{"contexts":["fasting"],"collections":["ramadan"],"life_stages":["toddler","child"]}', '{}', '{shared,sunni,shia}', false),
  ('rec.ramadan.share_iftar', 'Share iftar, cook what you need',
   'Share iftar with neighbours and guests, and cook the amount the family will eat; plan leftovers into the next day''s suhoor instead of throwing food away.',
   '{"contexts":["fasting"],"collections":["ramadan"]}', '{}', '{shared,sunni,shia}', false)
) as v(code, title, body, applies, contra, scope, science_only)
on conflict (code) do nothing;

-- Evidence links ---------------------------------------------------------------------------------------------------
insert into public.recommendation_evidence (recommendation_id, islamic_source_id, scientific_evidence_id, relationship)
select r.id, s.id, e.id, v.relationship
from (values
  ('rec.ramadan.suhoor_slow_release', 'hadith.bukhari.1923', null, 'context'),
  ('rec.ramadan.suhoor_slow_release', 'quran.2.187', null, 'context'),
  ('rec.ramadan.suhoor_slow_release', null, 'sci.fibre_intake.reynolds_2019', 'supports'),
  ('rec.ramadan.suhoor_slow_release', null, 'sci.barley_beta_glucan.abumweis_2010', 'supports'),
  ('rec.ramadan.suhoor_protein', 'quran.2.187', null, 'context'),
  ('rec.ramadan.suhoor_protein', null, 'sci.energy_macros.iom_2005', 'supports'),
  ('rec.ramadan.suhoor_fluids', 'quran.2.187', null, 'context'),
  ('rec.ramadan.suhoor_fluids', null, 'sci.water_needs.efsa_2010', 'supports'),
  ('rec.ramadan.suhoor_fluids', null, 'sci.water_electrolytes.iom_2005', 'supports'),
  ('rec.ramadan.suhoor_low_salt', 'quran.7.31', null, 'context'),
  ('rec.ramadan.suhoor_low_salt', null, 'sci.sodium.who_2012', 'supports'),
  ('rec.ramadan.suhoor_water_rich_foods', 'quran.2.187', null, 'context'),
  ('rec.ramadan.suhoor_water_rich_foods', 'hadith.bukhari.5440', null, 'context'),
  ('rec.ramadan.suhoor_water_rich_foods', null, 'sci.water_needs.efsa_2010', 'supports'),
  ('rec.ramadan.iftar_pause', 'hadith.abu_dawud.2356', null, 'supports'),
  ('rec.ramadan.iftar_pause', 'hadith.bukhari.1957', null, 'context'),
  ('rec.ramadan.iftar_pause', null, 'sci.eating_rate.robinson_2014', 'supports'),
  ('rec.ramadan.iftar_soup_first', 'quran.7.31', null, 'context'),
  ('rec.ramadan.iftar_soup_first', null, 'sci.veg_energy_density.ledoux_2011', 'supports'),
  ('rec.ramadan.iftar_normal_portion', 'quran.7.31', null, 'supports'),
  ('rec.ramadan.iftar_normal_portion', 'hadith.tirmidhi.2380', null, 'supports'),
  ('rec.ramadan.iftar_normal_portion', null, 'sci.eating_rate.robinson_2014', 'supports'),
  ('rec.ramadan.iftar_normal_portion', null, 'sci.ramadan_body_comp.fernando_2019', 'context'),
  ('rec.ramadan.fried_limit', 'quran.7.31', null, 'context'),
  ('rec.ramadan.fried_limit', null, 'sci.diet_chronic_disease.who_fao_2003', 'supports'),
  ('rec.ramadan.sweet_drinks', 'quran.7.31', null, 'context'),
  ('rec.ramadan.sweet_drinks', null, 'sci.free_sugars.who_2015', 'supports'),
  ('rec.ramadan.hydration_spread', 'quran.2.187', null, 'context'),
  ('rec.ramadan.hydration_spread', 'hadith.muslim.2028', null, 'context'),
  ('rec.ramadan.hydration_spread', null, 'sci.water_needs.efsa_2010', 'supports'),
  ('rec.ramadan.hydration_spread', null, 'sci.water_electrolytes.iom_2005', 'supports'),
  ('rec.ramadan.chai_timing', null, 'sci.tea_iron.hurrell_1999', 'supports'),
  ('rec.ramadan.chai_timing', null, 'sci.water_electrolytes.iom_2005', 'context'),
  ('rec.ramadan.taraweeh_snack', 'quran.16.66', null, 'context'),
  ('rec.ramadan.taraweeh_snack', null, 'sci.dairy_calcium.iom_2011', 'supports'),
  ('rec.ramadan.taraweeh_snack', null, 'sci.whole_fruit_t2d.muraki_2013', 'supports'),
  ('rec.ramadan.dates_diabetes', 'quran.2.183_185', null, 'context'),
  ('rec.ramadan.dates_diabetes', null, 'sci.diabetes_ramadan.idf_dar_2021', 'supports'),
  ('rec.ramadan.dates_diabetes', null, 'sci.dates_composition.alfarsi_2008', 'supports'),
  ('rec.ramadan.diabetes_pre_ramadan', 'quran.2.183_185', null, 'context'),
  ('rec.ramadan.diabetes_pre_ramadan', null, 'sci.diabetes_ramadan.idf_dar_2021', 'supports'),
  ('rec.ramadan.stop_signs', 'quran.2.183_185', null, 'supports'),
  ('rec.ramadan.stop_signs', null, 'sci.diabetes_ramadan.idf_dar_2021', 'context'),
  ('rec.ramadan.stop_signs', null, 'sci.water_needs.efsa_2010', 'context'),
  ('rec.ramadan.pregnancy_breastfeeding', 'quran.2.183_185', null, 'context'),
  ('rec.ramadan.pregnancy_breastfeeding', null, 'sci.water_needs.efsa_2010', 'supports'),
  ('rec.ramadan.pregnancy_breastfeeding', null, 'sci.energy_macros.iom_2005', 'supports'),
  ('rec.ramadan.children_suhoor', 'hadith.bukhari.1923', null, 'context'),
  ('rec.ramadan.children_suhoor', 'quran.2.187', null, 'context'),
  ('rec.ramadan.children_suhoor', null, 'sci.water_needs.efsa_2010', 'supports'),
  ('rec.ramadan.children_suhoor', null, 'sci.responsive_feeding.paho_who_2003', 'context'),
  ('rec.ramadan.under7_rituals', 'quran.2.183_185', null, 'context'),
  ('rec.ramadan.under7_rituals', null, 'sci.family_meals.hammons_2011', 'supports'),
  ('rec.ramadan.share_iftar', 'hadith.bukhari.5392', null, 'supports'),
  ('rec.ramadan.share_iftar', 'quran.7.31', null, 'context'),
  ('rec.ramadan.share_iftar', null, 'sci.food_waste.fao_2019', 'supports')
) as v(rec_code, source_code, sci_code, relationship)
join public.recommendations r on r.code = v.rec_code
left join public.islamic_sources s on s.code = v.source_code
left join public.scientific_evidence e on e.code = v.sci_code
where (v.source_code is null or s.id is not null)
  and (v.sci_code is null or e.id is not null)
  and not exists (select 1 from public.recommendation_evidence x
                  where x.recommendation_id = r.id
                    and x.islamic_source_id is not distinct from s.id
                    and x.scientific_evidence_id is not distinct from e.id);

-- guard: every code above resolved (a renamed source would otherwise drop out of the join silently)
do $$
declare v_missing text;
begin
  select string_agg(c, ', ') into v_missing
  from unnest(array['hadith.bukhari.1923','hadith.bukhari.1957','hadith.abu_dawud.2356','hadith.bukhari.5440',
                    'hadith.muslim.2028','hadith.tirmidhi.2380','hadith.bukhari.5392','quran.2.187','quran.7.31',
                    'quran.2.183_185','quran.16.66']) c
  where not exists (select 1 from public.islamic_sources s where s.code = c);
  if v_missing is not null then
    raise exception '125_ramadan_recommendations: islamic sources missing: %', v_missing;
  end if;
  select string_agg(c, ', ') into v_missing
  from unnest(array['sci.fibre_intake.reynolds_2019','sci.barley_beta_glucan.abumweis_2010','sci.energy_macros.iom_2005',
                    'sci.water_needs.efsa_2010','sci.water_electrolytes.iom_2005','sci.sodium.who_2012',
                    'sci.eating_rate.robinson_2014','sci.veg_energy_density.ledoux_2011','sci.ramadan_body_comp.fernando_2019',
                    'sci.diet_chronic_disease.who_fao_2003','sci.free_sugars.who_2015','sci.tea_iron.hurrell_1999',
                    'sci.dairy_calcium.iom_2011','sci.whole_fruit_t2d.muraki_2013','sci.diabetes_ramadan.idf_dar_2021',
                    'sci.dates_composition.alfarsi_2008','sci.responsive_feeding.paho_who_2003',
                    'sci.family_meals.hammons_2011','sci.food_waste.fao_2019']) c
  where not exists (select 1 from public.scientific_evidence e where e.code = c);
  if v_missing is not null then
    raise exception '125_ramadan_recommendations: scientific evidence missing: %', v_missing;
  end if;
end $$;
