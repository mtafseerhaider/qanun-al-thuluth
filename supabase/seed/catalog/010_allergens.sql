-- supabase/seed/catalog/010_allergens.sql
-- 05 section 19 order 1. EU Regulation 1169/2011 Annex II (14) + US FALCPA / FASTER Act (Big 9)
-- superset: 15 codes. US lists wheat separately from cereals containing gluten; the US "shellfish"
-- group is crustaceans (molluscs are EU-only). Idempotent upsert by code.
-- Urdu names need native-speaker review.
insert into public.allergens (code, name_i18n, eu14, us_big9) values
  ('gluten_cereals', '{"en":"Cereals containing gluten","ur":"گلوٹین والے اناج"}', true,  false),
  ('crustaceans',    '{"en":"Crustaceans (prawns, crab, lobster)","ur":"جھینگا، کیکڑا اور جھینگے نما سمندری غذا"}', true, true),
  ('eggs',           '{"en":"Eggs","ur":"انڈے"}',                                  true,  true),
  ('fish',           '{"en":"Fish","ur":"مچھلی"}',                                 true,  true),
  ('peanuts',        '{"en":"Peanuts","ur":"مونگ پھلی"}',                          true,  true),
  ('soy',            '{"en":"Soy","ur":"سویا"}',                                   true,  true),
  ('milk',           '{"en":"Milk","ur":"دودھ"}',                                  true,  true),
  ('tree_nuts',      '{"en":"Tree nuts (almonds, walnuts, cashews, pistachios)","ur":"خشک میوہ جات (بادام، اخروٹ، کاجو، پستہ)"}', true, true),
  ('celery',         '{"en":"Celery","ur":"اجوائن کا پودا (سیلری)"}',              true,  false),
  ('mustard',        '{"en":"Mustard","ur":"رائی / سرسوں"}',                       true,  false),
  ('sesame',         '{"en":"Sesame","ur":"تل"}',                                  true,  true),
  ('sulphites',      '{"en":"Sulphites","ur":"سلفائٹس"}',                          true,  false),
  ('lupin',          '{"en":"Lupin","ur":"لوپن"}',                                 true,  false),
  ('molluscs',       '{"en":"Molluscs","ur":"گھونگے اور سیپیاں"}',                 true,  false),
  ('wheat',          '{"en":"Wheat","ur":"گندم"}',                                 false, true)
on conflict (code) do update
  set name_i18n = excluded.name_i18n, eu14 = excluded.eu14, us_big9 = excluded.us_big9;
