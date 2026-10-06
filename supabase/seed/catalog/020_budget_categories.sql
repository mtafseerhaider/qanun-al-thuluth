-- supabase/seed/catalog/020_budget_categories.sql
-- 05 section 19 order 2. The 10 budget category codes (00-foundations section 6, CHECK on
-- budget_categories.code). Idempotent upsert by code. Urdu names need native-speaker review.
insert into public.budget_categories (code, name_i18n, sort_order) values
  ('staples',        '{"en":"Staples (flour, rice, sugar)","ur":"بنیادی اشیاء (آٹا، چاول، چینی)"}', 10),
  ('protein_animal', '{"en":"Meat, chicken, fish and eggs","ur":"گوشت، مرغی، مچھلی اور انڈے"}',   20),
  ('protein_plant',  '{"en":"Daal and beans","ur":"دالیں اور لوبیا"}',                          30),
  ('dairy',          '{"en":"Milk and dairy","ur":"دودھ اور ڈیری"}',                            40),
  ('produce_veg',    '{"en":"Vegetables","ur":"سبزیاں"}',                                       50),
  ('produce_fruit',  '{"en":"Fruit","ur":"پھل"}',                                               60),
  ('oils_fats',      '{"en":"Oil and ghee","ur":"تیل اور گھی"}',                                70),
  ('spices',         '{"en":"Spices and condiments","ur":"مصالحے اور چٹنیاں"}',                 80),
  ('beverages',      '{"en":"Beverages","ur":"مشروبات"}',                                       90),
  ('snacks',         '{"en":"Snacks and dry fruit","ur":"اسنیکس اور خشک میوہ"}',               100)
on conflict (code) do update
  set name_i18n = excluded.name_i18n, sort_order = excluded.sort_order;
