#!/usr/bin/env python3
"""Generate supabase/seed/catalog/040_ingredients.sql and 050_ingredient_allergens.sql (S1-19).

Nutrients come from the USDA National Nutrient Database for Standard Reference, Release 28
(SR28, "abbreviated" file ABBREV.txt). SR Legacy in FoodData Central (April 2018) carries the
SR28 foods and values; each row below cites its SR NDB number. FoodData Central itself was not
reachable from the build environment, so `fdc_id` is left null: back-fill it from FDC's
sr_legacy_food.csv (columns fdc_id, NDB_number) by matching the NDB numbers listed here.

Usage:
  python3 tooling/scripts/gen-ingredient-seed.py /path/to/sr28/ABBREV.txt

ABBREV.txt is in the SR28 ASCII download (sr28abbr.zip) and in the npm package
fda-nutrient-database@1.0.2 (data/ABBREV.txt). Values are per 100 g edible portion.
Columns used (SR28 doc p. 44): Energ_Kcal, Protein, Carbohydrt, Fiber_TD, Sugar_Tot, Lipid_Tot,
FA_Sat, Sodium, Iron, Calcium, Zinc, Vit_A_RAE, Vit_C, Vit_D_mcg, Vit_B12, Folate_DFE, Potassium.
omega3_g is not in the abbreviated file and stays null.

The input is checked against its sha256 in supabase/seed/checksums.txt (`sr28/ABBREV.txt`) before
anything is written.
"""
import hashlib
import os
import sys

# name, urdu, category, budget_category, default_unit, grams_per_unit, halal_status, sunnah,
# textures, color, ndb (None = not in SR28: nutrients stay null), allergen codes
V, F = 'vegetable', 'fruit'
ING = [
    # ---- vegetables and herbs ------------------------------------------------------------------
    ('Onion', 'پیاز', V, 'produce_veg', 'kg', None, 'halal', False, 'crunchy', 'purple', '11282', ''),
    ('Tomato', 'ٹماٹر', V, 'produce_veg', 'kg', None, 'halal', False, 'soft,wet', 'red', '11529', ''),
    ('Potato', 'آلو', V, 'produce_veg', 'kg', None, 'halal', False, 'soft', 'beige', '11352', ''),
    # dubba in the hadith literature is rendered both as gourd (lauki) and pumpkin (kaddu): both flagged, scholar review pending
    ('Bottle gourd (lauki)', 'لوکی', V, 'produce_veg', 'kg', None, 'halal', True, 'soft,wet', 'green', '11218', ''),
    ('Pumpkin (kaddu)', 'کدو', V, 'produce_veg', 'kg', None, 'halal', True, 'soft', 'orange', '11422', ''),
    ('Spinach (palak)', 'پالک', V, 'produce_veg', 'bunch', 250, 'halal', False, 'soft', 'green', '11457', ''),
    ('Garlic (lehsan)', 'لہسن', V, 'produce_veg', 'kg', None, 'halal', False, 'crunchy', 'white', '11215', ''),
    ('Ginger (adrak)', 'ادرک', V, 'produce_veg', 'kg', None, 'halal', False, 'crunchy', 'beige', '11216', ''),
    ('Green chilli (hari mirch)', 'ہری مرچ', V, 'produce_veg', 'kg', None, 'halal', False, 'crunchy', 'green', '11670', ''),
    ('Carrot (gajar)', 'گاجر', V, 'produce_veg', 'kg', None, 'halal', False, 'crunchy', 'orange', '11124', ''),
    ('Cauliflower (phool gobhi)', 'پھول گوبھی', V, 'produce_veg', 'kg', None, 'halal', False, 'crunchy', 'white', '11135', ''),
    ('Cabbage (band gobhi)', 'بند گوبھی', V, 'produce_veg', 'kg', None, 'halal', False, 'crunchy', 'green', '11109', ''),
    ('Okra (bhindi)', 'بھنڈی', V, 'produce_veg', 'kg', None, 'halal', False, 'soft', 'green', '11278', ''),
    ('Eggplant (baingan)', 'بینگن', V, 'produce_veg', 'kg', None, 'halal', False, 'soft', 'purple', '11209', ''),
    ('Bitter gourd (karela)', 'کریلا', V, 'produce_veg', 'kg', None, 'halal', False, 'crunchy', 'green', '11024', ''),
    ('Ridge gourd (tori)', 'توری', V, 'produce_veg', 'kg', None, 'halal', False, 'soft', 'green', '11220', ''),
    ('Turnip (shalgam)', 'شلجم', V, 'produce_veg', 'kg', None, 'halal', False, 'soft', 'white', '11564', ''),
    ('Radish (mooli)', 'مولی', V, 'produce_veg', 'kg', None, 'halal', False, 'crunchy', 'white', '11430', ''),
    ('Green peas (matar)', 'مٹر', V, 'produce_veg', 'kg', None, 'halal', False, 'soft', 'green', '11304', ''),
    ('Cucumber (kheera)', 'کھیرا', V, 'produce_veg', 'kg', None, 'halal', True, 'crunchy,wet', 'green', '11205', ''),
    ('Capsicum (shimla mirch)', 'شملہ مرچ', V, 'produce_veg', 'kg', None, 'halal', False, 'crunchy', 'green', '11333', ''),
    ('Coriander leaves (hara dhaniya)', 'ہرا دھنیا', 'spice_herb', 'produce_veg', 'bunch', 100, 'halal', False, 'soft', 'green', '11165', ''),
    ('Mint (podina)', 'پودینہ', 'spice_herb', 'produce_veg', 'bunch', 100, 'halal', False, 'soft', 'green', '02065', ''),
    ('Mustard greens (sarson)', 'سرسوں کا ساگ', V, 'produce_veg', 'kg', None, 'halal', False, 'soft', 'green', '11270', ''),
    ('Lettuce (salad patta)', 'سلاد پتہ', V, 'produce_veg', 'piece', 300, 'halal', False, 'crunchy', 'green', '11251', ''),
    ('Sweet potato (shakarkandi)', 'شکرقندی', V, 'produce_veg', 'kg', None, 'halal', False, 'soft', 'orange', '11507', ''),
    ('Beetroot (chukandar)', 'چقندر', V, 'produce_veg', 'kg', None, 'halal', False, 'crunchy', 'purple', '11080', ''),
    ('Green beans (phaliyan)', 'پھلیاں', V, 'produce_veg', 'kg', None, 'halal', False, 'crunchy', 'green', '11052', ''),
    ('Lotus root (kamal kakri)', 'کمل ککڑی', V, 'produce_veg', 'kg', None, 'halal', False, 'crunchy', 'beige', '11254', ''),
    ('Taro root (arvi)', 'اروی', V, 'produce_veg', 'kg', None, 'halal', False, 'soft', 'beige', '11518', ''),
    ('Mushrooms (khumbi)', 'کھمبی', V, 'produce_veg', 'kg', None, 'halal', False, 'chewy', 'white', '11260', ''),
    ('Spring onion (hara pyaz)', 'ہرا پیاز', V, 'produce_veg', 'bunch', 100, 'halal', False, 'crunchy', 'green', '11291', ''),
    ('Sweet corn (makai)', 'مکئی', V, 'produce_veg', 'piece', 90, 'halal', False, 'crunchy', 'yellow', '11167', ''),
    ('Drumstick pods (sohanjna)', 'سہانجنا کی پھلی', V, 'produce_veg', 'kg', None, 'halal', False, 'chewy', 'green', '11620', ''),
    # ---- fruit -----------------------------------------------------------------------------------
    ('Banana', 'کیلا', F, 'produce_fruit', 'dozen', 1400, 'halal', False, 'soft', 'yellow', '09040', ''),
    ('Guava (amrood)', 'امرود', F, 'produce_fruit', 'kg', None, 'halal', False, 'crunchy', 'green', '09139', ''),
    ('Mango (aam)', 'آم', F, 'produce_fruit', 'kg', None, 'halal', False, 'soft', 'orange', '09176', ''),
    ('Apple (saib)', 'سیب', F, 'produce_fruit', 'kg', None, 'halal', False, 'crunchy', 'red', '09003', ''),
    ('Kinnow (mandarin)', 'کینو', F, 'produce_fruit', 'dozen', 1800, 'halal', False, 'soft,wet', 'orange', '09218', ''),
    ('Orange (malta)', 'مالٹا', F, 'produce_fruit', 'dozen', 1560, 'halal', False, 'soft,wet', 'orange', '09200', ''),
    ('Pomegranate (anaar)', 'انار', F, 'produce_fruit', 'kg', None, 'halal', True, 'crunchy', 'red', '09286', ''),
    ('Grapes (angoor)', 'انگور', F, 'produce_fruit', 'kg', None, 'halal', True, 'soft', 'green', '09132', ''),
    ('Watermelon (tarbooz)', 'تربوز', F, 'produce_fruit', 'kg', None, 'halal', True, 'soft,wet', 'red', '09326', ''),
    ('Melon (kharbooza)', 'خربوزہ', F, 'produce_fruit', 'kg', None, 'halal', False, 'soft', 'orange', '09181', ''),
    ('Papaya (papita)', 'پپیتا', F, 'produce_fruit', 'kg', None, 'halal', False, 'soft', 'orange', '09226', ''),
    ('Figs, fresh (anjeer)', 'انجیر', F, 'produce_fruit', 'kg', None, 'halal', True, 'soft', 'purple', '09089', ''),
    ('Figs, dried (khushk anjeer)', 'خشک انجیر', F, 'produce_fruit', 'kg', None, 'halal', True, 'chewy', 'brown', '09094', ''),
    ('Dates (Aseel)', 'کھجور (اصیل)', F, 'produce_fruit', 'kg', None, 'halal', True, 'chewy', 'brown', '09087', ''),
    ('Apricot (khubani)', 'خوبانی', F, 'produce_fruit', 'kg', None, 'halal', False, 'soft', 'orange', '09021', ''),
    ('Apricots, dried (khushk khubani)', 'خشک خوبانی', F, 'produce_fruit', 'kg', None, 'halal', False, 'chewy', 'orange', '09032', 'sulphites'),
    ('Peach (aaru)', 'آڑو', F, 'produce_fruit', 'kg', None, 'halal', False, 'soft', 'orange', '09236', ''),
    ('Plum (aloo bukhara)', 'آلو بخارا', F, 'produce_fruit', 'kg', None, 'halal', False, 'soft', 'purple', '09279', ''),
    ('Strawberry', 'اسٹرابیری', F, 'produce_fruit', 'kg', None, 'halal', False, 'soft', 'red', '09316', ''),
    ('Lychee (leechi)', 'لیچی', F, 'produce_fruit', 'kg', None, 'halal', False, 'soft', 'white', '09164', ''),
    ('Pear (nashpati)', 'ناشپاتی', F, 'produce_fruit', 'kg', None, 'halal', False, 'crunchy', 'green', '09252', ''),
    ('Raisins (kishmish)', 'کشمش', F, 'produce_fruit', 'kg', None, 'halal', False, 'chewy', 'brown', '09298', ''),
    ('Lemon (leemu)', 'لیموں', F, 'produce_fruit', 'kg', None, 'halal', False, 'wet', 'yellow', '09150', ''),
    ('Tamarind (imli)', 'املی', F, 'spices', 'kg', None, 'halal', False, 'chewy', 'brown', '09322', ''),
    # ---- grains and breads -------------------------------------------------------------------------
    ('Chakki atta (whole wheat flour)', 'چکی آٹا', 'grain', 'staples', 'kg', None, 'halal', False, 'dry', 'brown', '20080', 'gluten_cereals,wheat'),
    ('Maida (white flour)', 'میدہ', 'grain', 'staples', 'kg', None, 'halal', False, 'dry', 'white', '20481', 'gluten_cereals,wheat'),
    ('Basmati rice (chawal)', 'باسمتی چاول', 'grain', 'staples', 'kg', None, 'halal', False, 'soft', 'white', '20444', ''),
    ('Brown rice', 'بھورے چاول', 'grain', 'staples', 'kg', None, 'halal', False, 'chewy', 'brown', '20036', ''),
    ('Whole barley (jau)', 'جو', 'grain', 'staples', 'kg', None, 'halal', True, 'chewy', 'beige', '20004', 'gluten_cereals'),
    ('Barley flour (jau ka atta)', 'جو کا آٹا', 'grain', 'staples', 'kg', None, 'halal', True, 'dry', 'beige', '20130', 'gluten_cereals'),
    ('Oats (jai)', 'جئی', 'grain', 'staples', 'kg', None, 'halal', False, 'soft', 'beige', '08120', 'gluten_cereals'),
    ('Semolina (sooji)', 'سوجی', 'grain', 'staples', 'kg', None, 'halal', False, 'dry', 'beige', '20466', 'gluten_cereals,wheat'),
    ('Vermicelli (seviyan)', 'سویاں', 'grain', 'staples', 'kg', None, 'halal', False, 'soft', 'beige', '20420', 'gluten_cereals,wheat'),
    ('Maize flour (makai ka atta)', 'مکئی کا آٹا', 'grain', 'staples', 'kg', None, 'halal', False, 'dry', 'yellow', '20020', ''),
    ('Millet (bajra)', 'باجرہ', 'grain', 'staples', 'kg', None, 'halal', False, 'chewy', 'beige', '20031', ''),
    ('Sorghum (jowar)', 'جوار', 'grain', 'staples', 'kg', None, 'halal', False, 'chewy', 'beige', '20067', ''),
    ('Broken wheat (daliya)', 'دلیہ', 'grain', 'staples', 'kg', None, 'halal', False, 'chewy', 'beige', '20012', 'gluten_cereals,wheat'),
    ('Cornflour (corn starch)', 'کارن فلور', 'grain', 'staples', 'kg', None, 'halal', False, 'dry', 'white', '20027', ''),
    ('Roti (chapati), whole wheat', 'روٹی', 'prepared', 'staples', 'piece', 40, 'halal', False, 'soft', 'beige', '28285', 'gluten_cereals,wheat'),
    ('Naan', 'نان', 'prepared', 'staples', 'piece', 90, 'halal', False, 'soft,chewy', 'beige', '28307', 'gluten_cereals,wheat'),
    ('Paratha', 'پراٹھا', 'prepared', 'staples', 'piece', 80, 'halal', False, 'soft,crispy', 'beige', '28286', 'gluten_cereals,wheat'),
    ('White bread (double roti)', 'ڈبل روٹی', 'prepared', 'staples', 'g', None, 'halal', False, 'soft', 'white', '18069', 'gluten_cereals,wheat'),
    # ---- legumes -----------------------------------------------------------------------------------
    ('Masoor daal', 'مسور کی دال', 'legume', 'protein_plant', 'kg', None, 'halal', False, 'soft', 'orange', '16144', ''),
    ('Whole masoor (brown lentils)', 'ثابت مسور', 'legume', 'protein_plant', 'kg', None, 'halal', False, 'soft', 'brown', '16069', ''),
    ('Kabuli chana', 'کابلی چنے', 'legume', 'protein_plant', 'kg', None, 'halal', False, 'soft', 'beige', '16056', ''),
    # no separate SR entry for split bengal gram: same values as whole chickpeas
    ('Chana daal (split chickpeas)', 'چنے کی دال', 'legume', 'protein_plant', 'kg', None, 'halal', False, 'soft', 'yellow', '16056', ''),
    ('Moong (mung beans)', 'مونگ', 'legume', 'protein_plant', 'kg', None, 'halal', False, 'soft', 'green', '16080', ''),
    ('Mash daal (urad)', 'ماش کی دال', 'legume', 'protein_plant', 'kg', None, 'halal', False, 'soft', 'white', '16083', ''),
    ('Red kidney beans (lal lobia)', 'لال لوبیا', 'legume', 'protein_plant', 'kg', None, 'halal', False, 'soft', 'red', '16032', ''),
    ('Black-eyed beans (lobia)', 'سفید لوبیا', 'legume', 'protein_plant', 'kg', None, 'halal', False, 'soft', 'white', '16062', ''),
    ('Besan (gram flour)', 'بیسن', 'legume', 'protein_plant', 'kg', None, 'halal', False, 'dry', 'yellow', '16157', ''),
    ('Peanuts (moongphali)', 'مونگ پھلی', 'legume', 'snacks', 'kg', None, 'halal', False, 'crunchy', 'brown', '16087', 'peanuts'),
    ('Pigeon peas (arhar daal)', 'ارہر کی دال', 'legume', 'protein_plant', 'kg', None, 'halal', False, 'soft', 'yellow', '16101', ''),
    # ---- meat, poultry, fish, eggs (halal status depends on zabiha sourcing) --------------------------
    ('Chicken, whole, with bone', 'مرغی (ثابت)', 'poultry', 'protein_animal', 'kg', None, 'depends_on_source', False, 'chewy', 'beige', '05006', ''),
    ('Chicken breast, boneless', 'مرغی کا سینہ (بغیر ہڈی)', 'poultry', 'protein_animal', 'kg', None, 'depends_on_source', False, 'chewy', 'beige', '05062', ''),
    ('Chicken thigh, boneless', 'مرغی کی ران (بغیر ہڈی)', 'poultry', 'protein_animal', 'kg', None, 'depends_on_source', False, 'chewy', 'beige', '05096', ''),
    ('Chicken liver (kaleji)', 'مرغی کی کلیجی', 'poultry', 'protein_animal', 'kg', None, 'depends_on_source', False, 'soft', 'brown', '05027', ''),
    ('Beef mince, lean', 'گائے کا قیمہ', 'meat', 'protein_animal', 'kg', None, 'depends_on_source', False, 'soft', 'red', '23562', ''),
    ('Beef, boneless', 'گائے کا گوشت (بغیر ہڈی)', 'meat', 'protein_animal', 'kg', None, 'depends_on_source', False, 'chewy', 'red', '23357', ''),
    ('Mutton (goat meat)', 'بکرے کا گوشت', 'meat', 'protein_animal', 'kg', None, 'depends_on_source', False, 'chewy', 'red', '17168', ''),
    ('Beef liver (kaleji)', 'گائے کی کلیجی', 'meat', 'protein_animal', 'kg', None, 'depends_on_source', False, 'soft', 'brown', '13325', ''),
    ('Eggs, farm', 'انڈے', 'egg', 'protein_animal', 'dozen', 600, 'halal', False, 'soft', 'white', '01123', 'eggs'),
    ('Fish, rohu (carp)', 'روہو مچھلی', 'fish', 'protein_animal', 'kg', None, 'halal', False, 'soft', 'white', '15008', 'fish'),
    ('Fish, surmai (king mackerel)', 'سرمئی مچھلی', 'fish', 'protein_animal', 'kg', None, 'halal', False, 'soft', 'white', '15049', 'fish'),
    # prawns: halal in most schools, some Hanafi scholars hold them makruh; scholar review pending
    ('Prawns (jhinga)', 'جھینگا', 'fish', 'protein_animal', 'kg', None, 'halal', False, 'chewy', 'white', '15149', 'crustaceans'),
    ('Tuna, canned in water', 'ٹونا مچھلی (ڈبے والی)', 'fish', 'protein_animal', 'g', None, 'halal', False, 'soft', 'beige', '15121', 'fish'),
    # ---- dairy ---------------------------------------------------------------------------------------
    ('Fresh milk', 'تازہ دودھ', 'dairy', 'dairy', 'l', 1030, 'halal', True, 'smooth', 'white', '01077', 'milk'),
    ('Buffalo milk', 'بھینس کا دودھ', 'dairy', 'dairy', 'l', 1030, 'halal', True, 'smooth', 'white', '01108', 'milk'),
    ('Yogurt (dahi)', 'دہی', 'dairy', 'dairy', 'kg', None, 'halal', False, 'smooth', 'white', '01116', 'milk'),
    ('Butter (makhan)', 'مکھن', 'dairy', 'dairy', 'g', None, 'halal', False, 'smooth', 'yellow', '01145', 'milk'),
    ('Cream (malai)', 'ملائی', 'dairy', 'dairy', 'g', None, 'halal', False, 'smooth', 'white', '01053', 'milk'),
    ('Cheddar cheese', 'چیڈر پنیر', 'dairy', 'dairy', 'g', None, 'depends_on_source', False, 'soft', 'yellow', '01009', 'milk'),
    ('Mozzarella cheese', 'موزریلا پنیر', 'dairy', 'dairy', 'g', None, 'depends_on_source', False, 'chewy', 'white', '01026', 'milk'),
    ('Milk powder', 'خشک دودھ', 'dairy', 'dairy', 'kg', None, 'halal', False, 'dry', 'white', '01090', 'milk'),
    ('Condensed milk', 'گاڑھا میٹھا دودھ', 'dairy', 'dairy', 'g', None, 'halal', False, 'smooth', 'white', '01095', 'milk'),
    ('Buttermilk (chhaach)', 'چھاچھ', 'dairy', 'dairy', 'l', 1030, 'halal', False, 'smooth', 'white', '01088', 'milk'),
    # ---- nuts and seeds ------------------------------------------------------------------------------
    ('Almonds (badam)', 'بادام', 'nut_seed', 'snacks', 'kg', None, 'halal', False, 'crunchy', 'brown', '12061', 'tree_nuts'),
    ('Walnuts (akhrot)', 'اخروٹ', 'nut_seed', 'snacks', 'kg', None, 'halal', False, 'crunchy', 'brown', '12155', 'tree_nuts'),
    ('Cashews (kaju)', 'کاجو', 'nut_seed', 'snacks', 'kg', None, 'halal', False, 'crunchy', 'beige', '12087', 'tree_nuts'),
    ('Pistachios (pista)', 'پستہ', 'nut_seed', 'snacks', 'kg', None, 'halal', False, 'crunchy', 'green', '12151', 'tree_nuts'),
    ('Pine nuts (chilgoza)', 'چلغوزہ', 'nut_seed', 'snacks', 'kg', None, 'halal', False, 'crunchy', 'beige', '12147', 'tree_nuts'),
    ('Sesame seeds (til)', 'تل', 'nut_seed', 'spices', 'g', None, 'halal', False, 'crunchy', 'white', '12023', 'sesame'),
    ('Flaxseed (alsi)', 'السی', 'nut_seed', 'spices', 'g', None, 'halal', False, 'crunchy', 'brown', '12220', ''),
    ('Desiccated coconut (khopra)', 'خشک ناریل', 'nut_seed', 'snacks', 'g', None, 'halal', False, 'dry', 'white', '12108', ''),
    # not in SR28: nutrients null until a Pakistan Food Composition Table value is reviewed
    ('Black seed (kalonji)', 'کلونجی', 'spice_herb', 'spices', 'g', None, 'halal', True, 'crunchy', 'black', None, ''),
    # ---- oils and fats -------------------------------------------------------------------------------
    ('Desi ghee', 'دیسی گھی', 'oil_fat', 'oils_fats', 'kg', None, 'halal', False, 'smooth', 'yellow', '01003', 'milk'),
    ('Banaspati ghee (vegetable shortening)', 'بناسپتی گھی', 'oil_fat', 'oils_fats', 'kg', None, 'halal', False, 'smooth', 'yellow', '04615', ''),
    ('Sunflower oil', 'سورج مکھی کا تیل', 'oil_fat', 'oils_fats', 'l', 920, 'halal', False, 'wet', 'yellow', '04060', ''),
    ('Canola oil', 'کینولا تیل', 'oil_fat', 'oils_fats', 'l', 920, 'halal', False, 'wet', 'yellow', '04582', ''),
    ('Olive oil', 'زیتون کا تیل', 'oil_fat', 'oils_fats', 'l', 920, 'halal', True, 'wet', 'green', '04053', ''),
    ('Soybean oil', 'سویابین کا تیل', 'oil_fat', 'oils_fats', 'l', 920, 'halal', False, 'wet', 'yellow', '04044', ''),
    # ---- sweeteners -----------------------------------------------------------------------------------
    ('Sugar (cheeni)', 'چینی', 'sweetener', 'staples', 'kg', None, 'halal', False, 'dry', 'white', '19335', ''),
    ('Honey (shehad)', 'شہد', 'sweetener', 'staples', 'kg', None, 'halal', True, 'smooth', 'orange', '19296', ''),
    ('Brown sugar (shakkar)', 'شکر', 'sweetener', 'staples', 'kg', None, 'halal', False, 'dry', 'brown', '19334', ''),
    # ---- spices -------------------------------------------------------------------------------------------
    ('Salt (namak)', 'نمک', 'spice_herb', 'spices', 'kg', None, 'halal', False, 'dry', 'white', '02047', ''),
    ('Turmeric (haldi)', 'ہلدی', 'spice_herb', 'spices', 'g', None, 'halal', False, 'dry', 'yellow', '02043', ''),
    ('Red chilli powder (lal mirch)', 'لال مرچ', 'spice_herb', 'spices', 'g', None, 'halal', False, 'dry', 'red', '02031', ''),
    ('Cumin seeds (zeera)', 'زیرہ', 'spice_herb', 'spices', 'g', None, 'halal', False, 'dry,crunchy', 'brown', '02014', ''),
    ('Coriander seeds (dhaniya)', 'دھنیا', 'spice_herb', 'spices', 'g', None, 'halal', False, 'dry,crunchy', 'beige', '02013', ''),
    ('Black pepper (kali mirch)', 'کالی مرچ', 'spice_herb', 'spices', 'g', None, 'halal', False, 'dry,crunchy', 'black', '02030', ''),
    ('Cinnamon (darchini)', 'دار چینی', 'spice_herb', 'spices', 'g', None, 'halal', False, 'dry', 'brown', '02010', ''),
    ('Green cardamom (elaichi)', 'سبز الائچی', 'spice_herb', 'spices', 'g', None, 'halal', False, 'dry', 'green', '02006', ''),
    ('Cloves (laung)', 'لونگ', 'spice_herb', 'spices', 'g', None, 'halal', False, 'dry', 'brown', '02011', ''),
    ('Fennel seeds (saunf)', 'سونف', 'spice_herb', 'spices', 'g', None, 'halal', False, 'dry,crunchy', 'green', '02018', ''),
    ('Fenugreek seeds (methi dana)', 'میتھی دانہ', 'spice_herb', 'spices', 'g', None, 'halal', False, 'dry,crunchy', 'yellow', '02019', ''),
    ('Mustard seeds (rai)', 'رائی', 'spice_herb', 'spices', 'g', None, 'halal', False, 'dry,crunchy', 'brown', '02024', 'mustard'),
    ('Bay leaf (tez patta)', 'تیز پات', 'spice_herb', 'spices', 'g', None, 'halal', False, 'dry', 'green', '02004', ''),
    ('Saffron (zafran)', 'زعفران', 'spice_herb', 'spices', 'g', None, 'halal', False, 'dry', 'red', '02037', ''),
    # ---- beverages and condiments ------------------------------------------------------------------------
    ('Black tea, brewed (chai)', 'چائے', 'beverage', 'beverages', 'ml', None, 'halal', False, 'wet', 'brown', '14355', ''),
    ('Green tea, brewed (sabz chai)', 'سبز چائے', 'beverage', 'beverages', 'ml', None, 'halal', False, 'wet', 'green', '14278', ''),
    ('Water', 'پانی', 'beverage', 'beverages', 'l', 1000, 'halal', False, 'wet', 'white', '14411', ''),
    ('Vinegar (sirka)', 'سرکہ', 'condiment', 'spices', 'ml', None, 'halal', True, 'wet', 'white', '02053', ''),
    ('Tomato ketchup', 'ٹماٹو کیچپ', 'condiment', 'spices', 'g', None, 'halal', False, 'smooth', 'red', '11935', ''),
    ('Tomato paste', 'ٹماٹر کا پیسٹ', 'condiment', 'produce_veg', 'g', None, 'halal', False, 'smooth', 'red', '11546', ''),
    # naturally brewed soy sauce can carry trace alcohol from fermentation
    ('Soy sauce', 'سویا ساس', 'condiment', 'spices', 'ml', None, 'mashbooh', False, 'wet', 'black', '16123', 'soy,gluten_cereals,wheat'),
    ('Mayonnaise', 'مایونیز', 'condiment', 'spices', 'g', None, 'depends_on_source', False, 'smooth', 'white', '04025', 'eggs'),
]

COLS = {  # ABBREV.txt field index -> seed column
    'kcal': 3, 'protein_g': 4, 'carbs_g': 7, 'fiber_g': 8, 'sugar_g': 9, 'fat_g': 5, 'sat_fat_g': 44,
    'sodium_mg': 15, 'iron_mg': 11, 'calcium_mg': 10, 'zinc_mg': 16, 'vitamin_a_mcg': 33,
    'vitamin_c_mg': 20, 'vitamin_d_mcg': 41, 'b12_mcg': 31, 'folate_mcg': 29, 'potassium_mg': 14,
}


TEXTURES = {'smooth', 'soft', 'crunchy', 'chewy', 'crispy', 'mixed', 'lumpy', 'wet', 'dry'}
COLORS = {'red', 'orange', 'yellow', 'green', 'purple', 'blue', 'white', 'beige', 'brown', 'black', 'mixed'}


def q(s):
    return "'" + s.replace("'", "''") + "'"


def load(path):
    rows = {}
    with open(path, encoding='latin-1') as fh:
        for line in fh:
            f = [x.strip('~') for x in line.rstrip('\r\n').split('^')]
            rows[f[0]] = f
    return rows


def check_sha256(path):
    sums = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'supabase', 'seed', 'checksums.txt')
    want = None
    with open(sums, encoding='utf-8') as fh:
        for line in fh:
            parts = line.split()
            if len(parts) == 2 and not line.startswith('#') and parts[1] == 'sr28/ABBREV.txt':
                want = parts[0]
    with open(path, 'rb') as fh:
        got = hashlib.sha256(fh.read()).hexdigest()
    if want is None or got != want:
        sys.exit(f'{path}: sha256 {got} does not match sr28/ABBREV.txt in supabase/seed/checksums.txt')


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    check_sha256(sys.argv[1])
    abb = load(sys.argv[1])
    names = [r[0].lower() for r in ING]
    assert len(names) == len(set(names)), 'duplicate ingredient names'
    # Food chaining (packages/ai-core/src/health/chaining.ts) reads textures and color: every row
    # needs both, from the public.texture enum and the ingredients.color check (S1 food catalog).
    for r in ING:
        assert r[8] and set(r[8].split(',')) <= TEXTURES, f'{r[0]}: textures {r[8]!r}'
        assert r[9] in COLORS, f'{r[0]}: color {r[9]!r}'
    out_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'supabase', 'seed', 'catalog')

    values = []
    for (name, ur, cat, budget, unit, gpu, halal, sunnah, textures, color, ndb, _a) in ING:
        nut = {}
        if ndb:
            f = abb[ndb]
            for col, idx in COLS.items():
                nut[col] = f[idx] if f[idx] != '' else None
            # SR rounding can leave sugar or saturated fat a hair above their totals; the CHECKs need <=
            for part, total in (('sugar_g', 'carbs_g'), ('sat_fat_g', 'fat_g')):
                if nut[part] is not None and nut[total] is not None and float(nut[part]) > float(nut[total]):
                    nut[part] = nut[total]
        nums = ', '.join(nut.get(c) or 'null' for c in COLS)
        tex = "'{" + textures + "}'" if textures else "'{}'"
        values.append(
            f"  ({q(name)}, {q(ur)}, {q(cat)}, {q(budget)}, {q(unit)}, {gpu if gpu else 'null'}, "
            f"{q(halal)}, {'true' if sunnah else 'false'}, {tex}, {q(color)}, {q(ndb) if ndb else 'null'}, {nums})")

    header = f"""-- supabase/seed/catalog/040_ingredients.sql
-- GENERATED by tooling/scripts/gen-ingredient-seed.py; edit the list there and re-run.
-- First {len(ING)} Pakistan ingredients (S1-19, 05 section 19 order 4). Idempotent: upsert keyed on
-- lower(name) (unique index ingredients_name_key).
--
-- NUTRIENT SOURCE: USDA National Nutrient Database for Standard Reference, Release 28 (SR28,
-- abbreviated file), per 100 g edible portion. SR Legacy in FoodData Central carries the same foods
-- and values. FoodData Central was not reachable from the build environment, so fdc_id is left
-- NULL; the SR NDB number of every row is kept in column ndb_no below for the fdc_id back-fill
-- (match FDC sr_legacy_food.csv NDB_number -> fdc_id). folate_mcg is folate DFE; omega3_g is not
-- in the abbreviated file and stays null. Black seed (kalonji) has no SR28 entry: nutrients null.
-- Split chickpeas reuse the whole chickpea entry (no separate SR food).
-- REVIEW REQUIRED before launch: (1) a registered dietitian checks every nutrient row and the
-- NDB match; (2) a native Urdu speaker reviews every name_i18n.ur; (3) the scholar panel reviews
-- is_sunnah_food and halal_status (gourd vs pumpkin for dubba, prawns, cheese rennet, soy sauce);
-- (4) a paediatric dietitian or feeding specialist reviews textures and color (food chaining,
-- 15 section 3.6). Textures describe the ingredient as bought or as usually served: flours,
-- powders and sugar are dry, whole seeds dry and crunchy, oils and drinks wet. Assigned by
-- engineering, not yet clinically reviewed.
"""
    sql = header + """
insert into public.ingredients (
  name, name_i18n, category, budget_category_id, default_unit, grams_per_unit, halal_status,
  is_sunnah_food, textures, color, kcal, protein_g, carbs_g, fiber_g, sugar_g, fat_g, sat_fat_g,
  sodium_mg, iron_mg, calcium_mg, zinc_mg, vitamin_a_mcg, vitamin_c_mg, vitamin_d_mcg, b12_mcg,
  folate_mcg, potassium_mg)
select v.name, jsonb_build_object('en', v.name, 'ur', v.name_ur), v.category, bc.id, v.default_unit,
       v.grams_per_unit, v.halal_status, v.is_sunnah_food, v.textures::public.texture[], v.color,
       v.kcal, v.protein_g, v.carbs_g, v.fiber_g, v.sugar_g, v.fat_g, v.sat_fat_g, v.sodium_mg, v.iron_mg,
       v.calcium_mg, v.zinc_mg, v.vitamin_a_mcg, v.vitamin_c_mg, v.vitamin_d_mcg, v.b12_mcg, v.folate_mcg,
       v.potassium_mg
from (values
""" + ',\n'.join(values) + """
) as v(name, name_ur, category, budget_code, default_unit, grams_per_unit, halal_status, is_sunnah_food,
       textures, color, ndb_no, kcal, protein_g, carbs_g, fiber_g, sugar_g, fat_g, sat_fat_g, sodium_mg,
       iron_mg, calcium_mg, zinc_mg, vitamin_a_mcg, vitamin_c_mg, vitamin_d_mcg, b12_mcg, folate_mcg,
       potassium_mg)
join public.budget_categories bc on bc.code = v.budget_code
on conflict ((lower(name))) do update set
  name_i18n = public.ingredients.name_i18n || excluded.name_i18n,
  category = excluded.category, budget_category_id = excluded.budget_category_id,
  default_unit = excluded.default_unit, grams_per_unit = excluded.grams_per_unit,
  halal_status = excluded.halal_status, is_sunnah_food = excluded.is_sunnah_food,
  textures = excluded.textures, color = excluded.color, kcal = excluded.kcal,
  protein_g = excluded.protein_g, carbs_g = excluded.carbs_g, fiber_g = excluded.fiber_g,
  sugar_g = excluded.sugar_g, fat_g = excluded.fat_g, sat_fat_g = excluded.sat_fat_g,
  sodium_mg = excluded.sodium_mg, iron_mg = excluded.iron_mg, calcium_mg = excluded.calcium_mg,
  zinc_mg = excluded.zinc_mg, vitamin_a_mcg = excluded.vitamin_a_mcg, vitamin_c_mg = excluded.vitamin_c_mg,
  vitamin_d_mcg = excluded.vitamin_d_mcg, b12_mcg = excluded.b12_mcg, folate_mcg = excluded.folate_mcg,
  potassium_mg = excluded.potassium_mg;
"""
    with open(os.path.join(out_dir, '040_ingredients.sql'), 'w', encoding='utf-8') as fh:
        fh.write(sql)

    pairs = [f'  ({q(r[0])}, {q(a)})' for r in ING for a in r[11].split(',') if a]
    sql2 = """-- supabase/seed/catalog/050_ingredient_allergens.sql
-- GENERATED by tooling/scripts/gen-ingredient-seed.py. Allergen links for 040_ingredients.sql
-- (05 section 19 order 5). Idempotent. Dietitian review required with 040.

insert into public.ingredient_allergens (ingredient_id, allergen_id)
select i.id, a.id
from (values
""" + ',\n'.join(pairs) + """
) as v(ingredient_name, allergen_code)
join public.ingredients i on lower(i.name) = lower(v.ingredient_name)
join public.allergens a on a.code = v.allergen_code
on conflict (ingredient_id, allergen_id) do nothing;
"""
    with open(os.path.join(out_dir, '050_ingredient_allergens.sql'), 'w', encoding='utf-8') as fh:
        fh.write(sql2)
    print(f'{len(ING)} ingredients, {len(pairs)} allergen links')


if __name__ == '__main__':
    main()
