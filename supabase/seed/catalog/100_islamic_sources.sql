-- supabase/seed/catalog/100_islamic_sources.sql
-- Content load v1, Islamic sources (S2-13, 05 section 19 order 10, 13 section 10.1). Idempotent:
-- every insert is `on conflict do nothing` / `where not exists`, so a re-run never overwrites a row
-- that reviewers have since corrected.
--
-- NOTHING IN THIS FILE IS SCHOLAR-REVIEWED. Every islamic_sources row is inserted `unverified`
-- (validate_islamic_source forces it anyway) with one source_verifications row of method
-- 'needs_verification' that says what is missing. islamic_sources_public, citable_islamic_sources,
-- search_islamic_sources() and match_knowledge() therefore return none of these rows until two
-- reviewers approve each one through the 13 section 8 workflow.
--
-- What each row still needs before review can start (13 sections 2 and 9):
--   * arabic_text is EMPTY ('') on purpose. 13 section 2 principle 3: Arabic is imported from an
--     authenticated corpus (Tanzil Uthmani via quran_text for the Qur'an; a permitted hadith corpus
--     or reviewed transcription for hadith), never typed by hand or generated. Import fills it.
--   * translation_i18n.en is a short DESCRIPTION OF MEANING written by the content team, not a
--     translation (kind = 'description'). It must never be shown in quotation marks (13 section 11
--     rule 8). Licensed Qur'an translations replace it per 13 section 9.1.
--   * translation_i18n has NO 'ur' key: no Urdu text was written. An Urdu-speaking scholar reviewer
--     supplies it (13 section 11).
--   * grade / graded_by: rows in al-Bukhari or Muslim carry 'sahih' with the compiler as grader;
--     Tirmidhi 2380 carries al-Albani's sahih. Every other grade is 'ungraded' pending the reviewer.
--   * Hadith numbers follow sunnah.com numbering (13 section 2 principle 5) and are to be checked
--     against the printed edition by the reviewer.
-- Shia narrations (13 section 10.1, 14 rows) are NOT seeded: the spec gives only collection and
-- chapter, and imam_narrations needs an exact volume/page/number locator. They wait for a Shia
-- hadith reviewer. Until then Shia users get only the shared (Qur'anic) layer, which content ops
-- tracks as a tradition gap (public.recommendation_completeness()).

-- Qur'an references (tradition 'shared') ------------------------------------------------------------
insert into public.quran_references (surah, ayah_start, ayah_end, arabic_text, translation_i18n, translator, topic_tags)
select v.surah, v.a1, v.a2, '',
       jsonb_build_object('en', jsonb_build_object(
         'text', v.meaning, 'kind', 'description',
         'translator', 'Thuluth content team (description of meaning, not a translation; unreviewed)',
         'license', 'own')),
       'pending licensed translation (13 section 9.1)', v.tags
from (values
  (7,   31, 31, 'Children of Adam are told to eat and drink, but not to be excessive, for Allah does not love those who are excessive.', '{moderation,eating,drinking}'::text[]),
  (2,  168,168, 'People are told to eat of what is on earth that is lawful and good (halalan tayyiban), and not to follow the footsteps of Satan.', '{halal_tayyib}'),
  (2,  172,172, 'Believers are told to eat of the good things provided for them and to be grateful to Allah.', '{gratitude,halal_tayyib}'),
  (20,  81, 81, 'Eat of the good things provided, and do not transgress in it.', '{moderation}'),
  (80,  24, 32, 'Let man look at his food: rain poured down, the earth split, and grain, grapes, herbs, olives, date palms, dense gardens, fruit and pasture grown as provision for people and their animals.', '{gratitude,grapes,olive_oil,dates}'),
  (16,  69, 69, 'Bees are inspired to eat of all fruits; from their bellies comes a drink of varying colours in which there is healing for people.', '{honey}'),
  (16,  66, 66, 'In cattle there is a lesson: pure milk, pleasant to drinkers, is given from between digested food and blood.', '{milk,gratitude}'),
  (95,   1,  1, 'An oath by the fig and the olive.', '{figs,olive_oil}'),
  (24,  35, 35, 'The parable of Allah''s light includes a lamp lit from a blessed olive tree whose oil would almost glow even untouched by fire.', '{olive_oil}'),
  (55,  68, 68, 'In the two gardens are fruit, date palms and pomegranates.', '{dates,pomegranate}'),
  (6,  141,141, 'Allah produces gardens, date palms, crops, olives and pomegranates; eat of their fruit, give their due on harvest day, and do not be excessive.', '{pomegranate,olive_oil,moderation,generosity}'),
  (19,  25, 26, 'Maryam is told to shake the trunk of the palm so ripe dates fall to her, and to eat, drink and be comforted.', '{dates,pregnancy}'),
  (2,  183,185, 'Fasting is prescribed so that you may attain taqwa; the month of Ramadan; those ill or travelling make up the days; Allah intends ease for you and not hardship.', '{fasting,ramadan}'),
  (2,  187,187, 'Eat and drink until the white thread of dawn becomes distinct from the black thread, then complete the fast until night.', '{suhoor,fasting,ramadan}')
) as v(surah, a1, a2, meaning, tags)
on conflict (surah, ayah_start, ayah_end) do nothing;

-- Sunni hadith references (tradition 'sunni') ---------------------------------------------------------
insert into public.hadith_references (collection, book, number, numbering_scheme, arabic_text, translation_i18n,
                                      narrator, grade, graded_by, tradition, also_in)
select v.collection, v.book, v.number, 'sunnah_com', '',
       jsonb_build_object('en', jsonb_build_object(
         'text', v.meaning, 'kind', 'description',
         'translator', 'Thuluth content team (working description, not a translation; unreviewed)',
         'license', 'own')),
       v.narrator, v.grade::public.evidence_grade_hadith, v.graded_by, 'sunni', v.also_in::jsonb
from (values
  ('tirmidhi', 'Abwab al-Zuhd', '2380', 'No human fills a vessel worse than his stomach; a few morsels to keep his back straight are enough, and if he must, then a third for his food, a third for his drink and a third for his breath.', 'al-Miqdam ibn Ma''dikarib', 'sahih', 'al-Albani', '[{"collection":"ibn_majah","number":"3349"}]'),
  ('bukhari', 'Kitab al-At''ima', '5376', 'The Prophet (peace be upon him) told a boy to mention the name of Allah, eat with his right hand, and eat from what is in front of him.', '''Umar ibn Abi Salamah', 'sahih', 'al-Bukhari', '[{"collection":"muslim","number":"2022"}]'),
  ('muslim', 'Kitab al-Ashriba', '2020', 'He instructed that one should eat with the right hand and drink with the right hand.', 'Ibn ''Umar', 'sahih', 'Muslim', '[]'),
  ('bukhari', 'Kitab al-At''ima', '5409', 'The Prophet (peace be upon him) never found fault with food: if he liked it he ate it, and if he disliked it he left it.', 'Abu Hurayrah', 'sahih', 'al-Bukhari', '[{"collection":"muslim","number":"2064"}]'),
  ('muslim', 'Kitab al-Ashriba', '2028', 'He would breathe three times while drinking (outside the vessel), and said this is more thirst-quenching, more wholesome and more pleasant.', 'Anas ibn Malik', 'sahih', 'Muslim', '[]'),
  ('bukhari', 'Kitab al-Ashriba', '5630', 'He forbade breathing into the drinking vessel.', 'Abu Qatadah', 'sahih', 'al-Bukhari', '[{"collection":"muslim","number":"267"}]'),
  ('bukhari', 'Kitab al-At''ima', '5392', 'Food for two is enough for three, and food for three is enough for four.', 'Abu Hurayrah', 'sahih', 'al-Bukhari', '[]'),
  ('muslim', 'Kitab al-Ashriba', '2059', 'Food for one is enough for two, food for two is enough for four, and food for four is enough for eight.', 'Jabir ibn ''Abdullah', 'sahih', 'Muslim', '[]'),
  ('bukhari', 'Kitab al-At''ima', '5393', 'The believer eats in one intestine while the disbeliever eats in seven; scholars read it as encouragement to moderation.', 'Ibn ''Umar', 'sahih', 'al-Bukhari', '[{"collection":"muslim","number":"2060"}]'),
  ('abu_dawud', 'Kitab al-At''imah', '3764', 'Companions said they ate but were not satisfied; he told them to gather together for their food and mention the name of Allah over it, and it would be blessed for them.', 'Wahshi ibn Harb', 'ungraded', null, '[{"collection":"ibn_majah","number":"3286"}]'),
  ('muslim', 'Kitab al-Ashriba', '2033', 'If a morsel falls, one should remove any dirt from it and eat it, and not leave it for Satan.', 'Jabir ibn ''Abdullah', 'sahih', 'Muslim', '[]'),
  ('muslim', 'Kitab al-Ashriba', '2046', 'A household that has no dates, its people are hungry.', '''A''ishah', 'sahih', 'Muslim', '[]'),
  ('bukhari', 'Kitab al-At''ima', '5440', 'He ate fresh dates with cucumber.', '''Abdullah ibn Ja''far', 'sahih', 'al-Bukhari', '[{"collection":"muslim","number":"2043"}]'),
  ('bukhari', 'Kitab al-At''ima', '5445', 'Whoever eats seven ''ajwa dates in the morning will not be harmed that day by poison or magic.', 'Sa''d ibn Abi Waqqas', 'sahih', 'al-Bukhari', '[{"collection":"muslim","number":"2047"}]'),
  ('bukhari', 'Kitab al-Tibb', '5684', 'A man reported his brother''s stomach complaint and was told, more than once, to give him honey.', 'Abu Sa''id al-Khudri', 'sahih', 'al-Bukhari', '[{"collection":"muslim","number":"2217"}]'),
  ('bukhari', 'Kitab al-Tibb', '5688', 'In the black seed there is healing for every disease except death.', 'Abu Hurayrah', 'sahih', 'al-Bukhari', '[{"collection":"muslim","number":"2215"}]'),
  ('muslim', 'Kitab al-Ashriba', '2052', 'What an excellent condiment vinegar is.', 'Jabir ibn ''Abdullah', 'sahih', 'Muslim', '[]'),
  ('bukhari', 'Kitab al-At''ima', '5379', 'Anas saw the Prophet (peace be upon him) seeking out the pieces of gourd around the dish, and loved gourd from that day.', 'Anas ibn Malik', 'sahih', 'al-Bukhari', '[{"collection":"muslim","number":"2041"}]'),
  ('bukhari', 'Kitab al-At''ima', '5417', '''A''ishah recommended talbina for the sick and for those grieving a death, reporting that it comforts the heart and takes away some of the grief.', '''A''ishah', 'sahih', 'al-Bukhari', '[{"collection":"bukhari","number":"5689"}]'),
  ('bukhari', 'Kitab al-At''ima', '5413', 'Asked whether the Prophet (peace be upon him) ate white flour, Sahl said they had no sieves: barley was ground, the husk blown away and the rest kneaded.', 'Sahl ibn Sa''d', 'sahih', 'al-Bukhari', '[]'),
  ('tirmidhi', 'Abwab al-At''imah', '1851', 'Eat olive oil and anoint yourselves with it, for it is from a blessed tree.', '''Umar ibn al-Khattab', 'ungraded', null, '[{"collection":"ibn_majah","number":"3319"}]'),
  ('tirmidhi', 'Abwab al-Da''awat', '3455', 'When given milk to drink, say: O Allah, bless it for us and give us more of it.', 'Ibn ''Abbas', 'ungraded', null, '[]'),
  ('bukhari', 'Kitab al-Sawm', '1923', 'Take suhoor, for in suhoor there is blessing.', 'Anas ibn Malik', 'sahih', 'al-Bukhari', '[{"collection":"muslim","number":"1095"}]'),
  ('bukhari', 'Kitab al-Sawm', '1921', 'They took suhoor with the Prophet (peace be upon him), then stood for prayer; the gap was about the time of reciting fifty verses.', 'Zayd ibn Thabit', 'sahih', 'al-Bukhari', '[]'),
  ('bukhari', 'Kitab al-Sawm', '1957', 'People will remain upon goodness as long as they hasten to break the fast.', 'Sahl ibn Sa''d', 'sahih', 'al-Bukhari', '[{"collection":"muslim","number":"1098"}]'),
  ('abu_dawud', 'Kitab al-Sawm', '2356', 'He broke his fast with fresh dates before praying; if there were none, with dried dates; if none, with a few sips of water.', 'Anas ibn Malik', 'ungraded', null, '[{"collection":"tirmidhi","number":"696"}]'),
  ('muslim', 'Kitab al-Dhikr wa al-Du''a', '2734', 'Allah is pleased with a servant who eats a meal and praises Him for it, or drinks a drink and praises Him for it.', 'Anas ibn Malik', 'sahih', 'Muslim', '[]'),
  ('bukhari', 'Kitab al-At''ima', '5458', 'When his meal was cleared he would praise Allah with abundant, good and blessed praise.', 'Abu Umamah', 'sahih', 'al-Bukhari', '[]')
) as v(collection, book, number, meaning, narrator, grade, graded_by, also_in)
on conflict (collection, numbering_scheme, number) do nothing;

-- islamic_sources index rows (verification_status forced to 'unverified' by the trigger) ------------
insert into public.islamic_sources (kind, ref_id, tradition, code, citation_text, topic_tags)
select 'quran', q.id, 'shared', v.code, v.citation, q.topic_tags
from (values
  ('quran.7.31',      7,  31, 31, 'Qur''an, al-A''raf 7:31'),
  ('quran.2.168',     2, 168,168, 'Qur''an, al-Baqarah 2:168'),
  ('quran.2.172',     2, 172,172, 'Qur''an, al-Baqarah 2:172'),
  ('quran.20.81',    20,  81, 81, 'Qur''an, Ta-Ha 20:81'),
  ('quran.80.24_32', 80,  24, 32, 'Qur''an, ''Abasa 80:24-32'),
  ('quran.16.69',    16,  69, 69, 'Qur''an, al-Nahl 16:69'),
  ('quran.16.66',    16,  66, 66, 'Qur''an, al-Nahl 16:66'),
  ('quran.95.1',     95,   1,  1, 'Qur''an, al-Tin 95:1'),
  ('quran.24.35',    24,  35, 35, 'Qur''an, al-Nur 24:35'),
  ('quran.55.68',    55,  68, 68, 'Qur''an, al-Rahman 55:68'),
  ('quran.6.141',     6, 141,141, 'Qur''an, al-An''am 6:141'),
  ('quran.19.25_26', 19,  25, 26, 'Qur''an, Maryam 19:25-26'),
  ('quran.2.183_185', 2, 183,185, 'Qur''an, al-Baqarah 2:183-185'),
  ('quran.2.187',     2, 187,187, 'Qur''an, al-Baqarah 2:187')
) as v(code, surah, a1, a2, citation)
join public.quran_references q on q.surah = v.surah and q.ayah_start = v.a1 and q.ayah_end = v.a2
on conflict (code) do nothing;

insert into public.islamic_sources (kind, ref_id, tradition, code, citation_text, topic_tags)
select 'hadith', h.id, 'sunni', v.code, v.citation, v.tags
from (values
  ('hadith.tirmidhi.2380', 'tirmidhi', '2380', 'Jami'' al-Tirmidhi 2380; Sunan Ibn Majah 3349 (sahih, al-Albani)', '{moderation,rule_of_thirds,eating,drinking}'::text[]),
  ('hadith.bukhari.5376',  'bukhari',  '5376', 'Sahih al-Bukhari 5376; Sahih Muslim 2022', '{etiquette,bismillah,children}'),
  ('hadith.muslim.2020',   'muslim',   '2020', 'Sahih Muslim 2020', '{etiquette}'),
  ('hadith.bukhari.5409',  'bukhari',  '5409', 'Sahih al-Bukhari 5409; Sahih Muslim 2064', '{etiquette,gratitude}'),
  ('hadith.muslim.2028',   'muslim',   '2028', 'Sahih Muslim 2028', '{etiquette,drinking,water}'),
  ('hadith.bukhari.5630',  'bukhari',  '5630', 'Sahih al-Bukhari 5630; Sahih Muslim 267', '{etiquette,drinking}'),
  ('hadith.bukhari.5392',  'bukhari',  '5392', 'Sahih al-Bukhari 5392', '{moderation,generosity,eating_together}'),
  ('hadith.muslim.2059',   'muslim',   '2059', 'Sahih Muslim 2059', '{moderation,generosity,eating_together}'),
  ('hadith.bukhari.5393',  'bukhari',  '5393', 'Sahih al-Bukhari 5393; Sahih Muslim 2060', '{moderation}'),
  ('hadith.abu_dawud.3764','abu_dawud','3764', 'Sunan Abi Dawud 3764; Sunan Ibn Majah 3286 (grade to be confirmed)', '{eating_together,bismillah}'),
  ('hadith.muslim.2033',   'muslim',   '2033', 'Sahih Muslim 2033', '{waste,etiquette}'),
  ('hadith.muslim.2046',   'muslim',   '2046', 'Sahih Muslim 2046', '{dates}'),
  ('hadith.bukhari.5440',  'bukhari',  '5440', 'Sahih al-Bukhari 5440; Sahih Muslim 2043', '{dates,cucumber}'),
  ('hadith.bukhari.5445',  'bukhari',  '5445', 'Sahih al-Bukhari 5445; Sahih Muslim 2047', '{dates}'),
  ('hadith.bukhari.5684',  'bukhari',  '5684', 'Sahih al-Bukhari 5684; Sahih Muslim 2217', '{honey,illness_comfort}'),
  ('hadith.bukhari.5688',  'bukhari',  '5688', 'Sahih al-Bukhari 5688; Sahih Muslim 2215', '{black_seed}'),
  ('hadith.muslim.2052',   'muslim',   '2052', 'Sahih Muslim 2052', '{vinegar}'),
  ('hadith.bukhari.5379',  'bukhari',  '5379', 'Sahih al-Bukhari 5379; Sahih Muslim 2041', '{gourd}'),
  ('hadith.bukhari.5417',  'bukhari',  '5417', 'Sahih al-Bukhari 5417 (also 5689)', '{talbina,barley,illness_comfort}'),
  ('hadith.bukhari.5413',  'bukhari',  '5413', 'Sahih al-Bukhari 5413', '{barley}'),
  ('hadith.tirmidhi.1851', 'tirmidhi', '1851', 'Jami'' al-Tirmidhi 1851; Sunan Ibn Majah 3319 (grade to be confirmed)', '{olive_oil}'),
  ('hadith.tirmidhi.3455', 'tirmidhi', '3455', 'Jami'' al-Tirmidhi 3455 (grade to be confirmed)', '{milk,gratitude}'),
  ('hadith.bukhari.1923',  'bukhari',  '1923', 'Sahih al-Bukhari 1923; Sahih Muslim 1095', '{suhoor,fasting,ramadan}'),
  ('hadith.bukhari.1921',  'bukhari',  '1921', 'Sahih al-Bukhari 1921', '{suhoor,fasting}'),
  ('hadith.bukhari.1957',  'bukhari',  '1957', 'Sahih al-Bukhari 1957; Sahih Muslim 1098', '{iftar,fasting}'),
  ('hadith.abu_dawud.2356','abu_dawud','2356', 'Sunan Abi Dawud 2356; Jami'' al-Tirmidhi 696 (grade to be confirmed)', '{iftar,dates,water,fasting}'),
  ('hadith.muslim.2734',   'muslim',   '2734', 'Sahih Muslim 2734', '{gratitude,etiquette}'),
  ('hadith.bukhari.5458',  'bukhari',  '5458', 'Sahih al-Bukhari 5458', '{gratitude,etiquette}')
) as v(code, collection, number, citation, tags)
join public.hadith_references h on h.collection = v.collection and h.numbering_scheme = 'sunnah_com' and h.number = v.number
on conflict (code) do nothing;

-- One 'needs_verification' record per seeded source (13 section 2 principle 4). Not an approval:
-- action is null and status 'unverified', so the source stays unverified.
insert into public.source_verifications (islamic_source_id, status, reviewer_name, reviewer_credentials, method, notes)
select s.id, 'unverified', 'Thuluth content seed S2-13 (automated, not a review)',
       'none: no scholar has reviewed this row', 'needs_verification',
       concat_ws('; ',
         'arabic_text empty: import from an authenticated corpus (never typed by hand)',
         'en text is a working description, not a translation: replace with an approved translation',
         'ur translation missing: Urdu-speaking reviewer to supply',
         case when s.kind = 'hadith' then 'confirm number against the printed edition and confirm grade and grader' end,
         'two approvals required (13 section 8)')
from public.islamic_sources s
where s.code in (
  'quran.7.31','quran.2.168','quran.2.172','quran.20.81','quran.80.24_32','quran.16.69','quran.16.66','quran.95.1',
  'quran.24.35','quran.55.68','quran.6.141','quran.19.25_26','quran.2.183_185','quran.2.187',
  'hadith.tirmidhi.2380','hadith.bukhari.5376','hadith.muslim.2020','hadith.bukhari.5409','hadith.muslim.2028',
  'hadith.bukhari.5630','hadith.bukhari.5392','hadith.muslim.2059','hadith.bukhari.5393','hadith.abu_dawud.3764',
  'hadith.muslim.2033','hadith.muslim.2046','hadith.bukhari.5440','hadith.bukhari.5445','hadith.bukhari.5684',
  'hadith.bukhari.5688','hadith.muslim.2052','hadith.bukhari.5379','hadith.bukhari.5417','hadith.bukhari.5413',
  'hadith.tirmidhi.1851','hadith.tirmidhi.3455','hadith.bukhari.1923','hadith.bukhari.1921','hadith.bukhari.1957',
  'hadith.abu_dawud.2356','hadith.muslim.2734','hadith.bukhari.5458')
  and not exists (select 1 from public.source_verifications v
                  where v.islamic_source_id = s.id and v.method = 'needs_verification');

-- Foods named in the sources (FR-ISL-08). Links to the S1-19 ingredients by name. -------------------
insert into public.foods_in_narrations (islamic_source_id, ingredient_id, food_label, context)
select s.id, i.id, v.label, v.context
from (values
  ('quran.80.24_32',      'Grapes (angoor)',                'grapes',            'mentioned'),
  ('quran.80.24_32',      'Dates (Aseel)',                  'date palms',        'mentioned'),
  ('quran.80.24_32',      'Olive oil',                      'olives',            'mentioned'),
  ('quran.16.69',         'Honey (shehad)',                 'honey',             'mentioned'),
  ('quran.16.66',         'Fresh milk',                     'milk',              'mentioned'),
  ('quran.95.1',          'Figs, fresh (anjeer)',           'fig',               'mentioned'),
  ('quran.95.1',          'Olive oil',                      'olive',             'mentioned'),
  ('quran.24.35',         'Olive oil',                      'olive oil',         'mentioned'),
  ('quran.55.68',         'Dates (Aseel)',                  'date palms',        'mentioned'),
  ('quran.55.68',         'Pomegranate (anaar)',            'pomegranates',      'mentioned'),
  ('quran.6.141',         'Pomegranate (anaar)',            'pomegranates',      'mentioned'),
  ('quran.6.141',         'Olive oil',                      'olives',            'mentioned'),
  ('quran.19.25_26',      'Dates (Aseel)',                  'ripe dates',        'mentioned'),
  ('hadith.muslim.2046',  'Dates (Aseel)',                  'dates',             'recommended'),
  ('hadith.bukhari.5440', 'Dates (Aseel)',                  'fresh dates',       'mentioned'),
  ('hadith.bukhari.5440', 'Cucumber (kheera)',              'cucumber',          'mentioned'),
  ('hadith.bukhari.5445', 'Dates (Aseel)',                  '''ajwa dates',      'mentioned'),
  ('hadith.bukhari.5684', 'Honey (shehad)',                 'honey',             'mentioned'),
  ('hadith.bukhari.5688', 'Black seed (kalonji)',           'black seed',        'mentioned'),
  ('hadith.muslim.2052',  'Vinegar (sirka)',                'vinegar',           'recommended'),
  ('hadith.bukhari.5379', 'Bottle gourd (lauki)',           'gourd (dubba)',     'mentioned'),
  ('hadith.bukhari.5417', 'Barley flour (jau ka atta)',     'talbina',           'recommended'),
  ('hadith.bukhari.5413', 'Whole barley (jau)',             'barley',            'mentioned'),
  ('hadith.tirmidhi.1851','Olive oil',                      'olive oil',         'recommended'),
  ('hadith.tirmidhi.3455','Fresh milk',                     'milk',              'mentioned'),
  ('hadith.abu_dawud.2356','Dates (Aseel)',                 'fresh or dried dates', 'mentioned'),
  ('hadith.abu_dawud.2356','Water',                         'water',             'mentioned')
) as v(code, ingredient, label, context)
join public.islamic_sources s on s.code = v.code
left join public.ingredients i on lower(i.name) = lower(v.ingredient)
where not exists (select 1 from public.foods_in_narrations f
                  where f.islamic_source_id = s.id and f.food_label = v.label);
