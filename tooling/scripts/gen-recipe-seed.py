#!/usr/bin/env python3
"""Generate the catalog seeds 090_recipes.sql (200 curated Pakistani home recipes, S2-16 and S3-16),
092_meals.sql (meals, reference and meal portions, meal alternatives; S3-02, S3-16) and
095_seasonal_produce.sql (Punjab produce calendar). The meal and portion rules are in the Sprint 3
section near the end of this file.

Every ingredient is one of the 150 Sprint 1 catalog ingredients (supabase/seed/catalog/040_ingredients.sql).
per_serving_nutrition is computed here from the 040 nutrient values with the same formula and
rounding as public.recompute_recipe_nutrition() (05 section 15.13): sum(nutrient * grams / 100) /
servings over the non-optional ingredients, kcal and macros to 1 dp, sodium/calcium/vitamin A/
folate/potassium/grams to 0 dp, iron/zinc/vitamin D/B12 to 2 dp, omega3 to 3 dp, nulls dropped.
The recipe_ingredients trigger recomputes the same value inside the database when the seed loads;
the copy written into the INSERT keeps the seed readable and lets a diff show nutrition drift.

Grams are RAW edible weights (dry rice, dry lentils, raw meat). Bone-in meat is written as bought
('1000 g bone-in') and converted to edible grams with a flat yield (chicken 0.70, mutton and beef 0.75)
because the SR28 values are per 100 g of edible portion; the dietitian review should confirm the yields. Water added while
cooking is described in the steps and is not an ingredient row, so per-serving "grams" is the
raw ingredient weight per serving, not the cooked plate weight.

Usage:
  python3 tooling/scripts/gen-recipe-seed.py            # writes supabase/seed/catalog/090_recipes.sql
  python3 tooling/scripts/gen-recipe-seed.py --check    # exits 1 if the committed file is stale

REVIEW REQUIRED before any recipe is set to review_status 'verified' (which is what makes it visible
to users under 05 16.3.3 RLS): a registered dietitian checks quantities, servings, nutrition and the
kid/autism/Ramadan flags; a native Urdu speaker supplies title_i18n.ur (left out here on purpose);
meat, poultry and fish rows depend on a zabiha/halal source (ingredients.halal_status
'depends_on_source').
"""
import json
import os
import re
import sys
from decimal import ROUND_HALF_UP, Decimal, getcontext
from fractions import Fraction

getcontext().prec = 40

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
ING_SQL = os.path.join(ROOT, 'supabase', 'seed', 'catalog', '040_ingredients.sql')
OUT_SQL = os.path.join(ROOT, 'supabase', 'seed', 'catalog', '090_recipes.sql')
MEALS_SQL = os.path.join(ROOT, 'supabase', 'seed', 'catalog', '092_meals.sql')
SEASON_SQL = os.path.join(ROOT, 'supabase', 'seed', 'catalog', '095_seasonal_produce.sql')

NUTRIENTS = [
    # key, column index in the 040 values tuple, rounding digits
    ('kcal', 11, 1), ('protein_g', 12, 1), ('carbs_g', 13, 1), ('fiber_g', 14, 1), ('sugar_g', 15, 1),
    ('fat_g', 16, 1), ('sat_fat_g', 17, 1), ('sodium_mg', 18, 0), ('iron_mg', 19, 2),
    ('calcium_mg', 20, 0), ('zinc_mg', 21, 2), ('vitamin_a_mcg', 22, 0), ('vitamin_c_mg', 23, 1),
    ('vitamin_d_mcg', 24, 2), ('b12_mcg', 25, 2), ('folate_mcg', 26, 0), ('potassium_mg', 27, 0),
]
# omega3_g is null for every 040 row (not in SR28 abbreviated), so it never appears in the output.

# ---------------------------------------------------------------------------------------------------
# Ingredient aliases: alias -> (catalog name, {unit: grams per unit}). 'g' is always 1 g.
# Household measures: tsp/tbsp/cup weights from USDA SR28 household weights where available.
# ---------------------------------------------------------------------------------------------------
A = {
    # vegetables
    'onion': ('Onion', {'medium': 110}),
    'tomato': ('Tomato', {'medium': 120}),
    'potato': ('Potato', {'medium': 150}),
    'lauki': ('Bottle gourd (lauki)', {}),
    'kaddu': ('Pumpkin (kaddu)', {}),
    'spinach': ('Spinach (palak)', {'bunch': 250}),
    'garlic': ('Garlic (lehsan)', {'tbsp paste': 12, 'clove': 3}),
    'ginger': ('Ginger (adrak)', {'tbsp paste': 12, 'inch': 10}),
    'chilli': ('Green chilli (hari mirch)', {'piece': 5}),
    'carrot': ('Carrot (gajar)', {'medium': 70}),
    'gobhi': ('Cauliflower (phool gobhi)', {}),
    'cabbage': ('Cabbage (band gobhi)', {}),
    'bhindi': ('Okra (bhindi)', {}),
    'baingan': ('Eggplant (baingan)', {}),
    'karela': ('Bitter gourd (karela)', {}),
    'tori': ('Ridge gourd (tori)', {}),
    'shalgam': ('Turnip (shalgam)', {}),
    'mooli': ('Radish (mooli)', {}),
    'peas': ('Green peas (matar)', {'cup': 145}),
    'cucumber': ('Cucumber (kheera)', {'medium': 200}),
    'capsicum': ('Capsicum (shimla mirch)', {'medium': 120}),
    'coriander': ('Coriander leaves (hara dhaniya)', {'handful': 15}),
    'mint': ('Mint (podina)', {'handful': 10}),
    'sarson': ('Mustard greens (sarson)', {}),
    'lettuce': ('Lettuce (salad patta)', {}),
    'shakarkandi': ('Sweet potato (shakarkandi)', {'medium': 130}),
    'beetroot': ('Beetroot (chukandar)', {'medium': 80}),
    'phaliyan': ('Green beans (phaliyan)', {}),
    'kamal': ('Lotus root (kamal kakri)', {}),
    'arvi': ('Taro root (arvi)', {}),
    'mushroom': ('Mushrooms (khumbi)', {}),
    'springonion': ('Spring onion (hara pyaz)', {'bunch': 100}),
    'corn': ('Sweet corn (makai)', {'cob': 90, 'cup': 145}),
    'drumstick': ('Drumstick pods (sohanjna)', {}),
    # fruit
    'lemon': ('Lemon (leemu)', {'juiced': 30}),
    'banana': ('Banana', {'medium': 118}),
    'apple': ('Apple (saib)', {'medium': 180}),
    'guava': ('Guava (amrood)', {'medium': 100}),
    'kinnow': ('Kinnow (mandarin)', {'medium': 90}),
    'pomegranate': ('Pomegranate (anaar)', {'cup': 87}),
    'mango': ('Mango (aam)', {'cup': 165}),
    'papaya': ('Papaya (papita)', {'cup': 145}),
    'dates': ('Dates (Aseel)', {'piece': 8}),
    'raisins': ('Raisins (kishmish)', {'tbsp': 9}),
    'tamarind': ('Tamarind (imli)', {}),
    'plum': ('Plum (aloo bukhara)', {'piece': 15}),
    'apricotdried': ('Apricots, dried (khushk khubani)', {'piece': 8}),
    'figdried': ('Figs, dried (khushk anjeer)', {'piece': 8}),
    'watermelon': ('Watermelon (tarbooz)', {'cup': 152}),
    'melon': ('Melon (kharbooza)', {'cup': 160}),
    'grapes': ('Grapes (angoor)', {'cup': 150}),
    'pear': ('Pear (nashpati)', {'medium': 170}),
    # grains, flours, breads
    'atta': ('Chakki atta (whole wheat flour)', {'cup': 120, 'tbsp': 7.5}),
    'maida': ('Maida (white flour)', {'cup': 125, 'tbsp': 8}),
    'rice': ('Basmati rice (chawal)', {'cup': 185}),
    'brownrice': ('Brown rice', {'cup': 190}),
    'daliya': ('Broken wheat (daliya)', {'cup': 140}),
    'sooji': ('Semolina (sooji)', {'cup': 167, 'tbsp': 10}),
    'oats': ('Oats (jai)', {'cup': 81}),
    'seviyan': ('Vermicelli (seviyan)', {'cup': 50}),
    'makaiatta': ('Maize flour (makai ka atta)', {'cup': 117, 'tbsp': 7.5}),
    'bajra': ('Millet (bajra)', {}),
    'jau': ('Whole barley (jau)', {'cup': 184}),
    'jauatta': ('Barley flour (jau ka atta)', {'cup': 148}),
    'cornflour': ('Cornflour (corn starch)', {'tbsp': 8}),
    'naan': ('Naan', {'piece': 90}),
    'roti': ('Roti (chapati), whole wheat', {'piece': 40}),
    'bread': ('White bread (double roti)', {'slice': 25}),
    # legumes
    'besan': ('Besan (gram flour)', {'cup': 92, 'tbsp': 6}),
    'masoor': ('Masoor daal', {'cup': 192}),
    'sabutmasoor': ('Whole masoor (brown lentils)', {'cup': 192}),
    'chanadaal': ('Chana daal (split chickpeas)', {'cup': 200}),
    'kabuli': ('Kabuli chana', {'cup': 200}),
    'mash': ('Mash daal (urad)', {'cup': 200}),
    'moong': ('Moong (mung beans)', {'cup': 207}),
    'lobia': ('Black-eyed beans (lobia)', {'cup': 167}),
    'rajma': ('Red kidney beans (lal lobia)', {'cup': 184}),
    'arhar': ('Pigeon peas (arhar daal)', {'cup': 205}),
    'peanuts': ('Peanuts (moongphali)', {'tbsp': 9}),
    # meat, poultry, fish, eggs
    'chicken': ('Chicken, whole, with bone', {'g bone-in': 0.70}),  # SR value is per 100 g edible meat and skin
    'breast': ('Chicken breast, boneless', {}),
    'thigh': ('Chicken thigh, boneless', {}),
    'chickenliver': ('Chicken liver (kaleji)', {}),
    'beef': ('Beef, boneless', {'g bone-in': 0.75}),
    'mince': ('Beef mince, lean', {}),
    'beefliver': ('Beef liver (kaleji)', {}),
    'mutton': ('Mutton (goat meat)', {'g bone-in': 0.75}),
    'rohu': ('Fish, rohu (carp)', {}),
    'surmai': ('Fish, surmai (king mackerel)', {}),
    'prawns': ('Prawns (jhinga)', {}),
    'tuna': ('Tuna, canned in water', {}),
    'egg': ('Eggs, farm', {'piece': 50}),
    # dairy
    'yogurt': ('Yogurt (dahi)', {'cup': 245, 'tbsp': 15}),
    'milk': ('Fresh milk', {'cup': 244}),
    'buttermilk': ('Buttermilk (chhaach)', {'cup': 245}),
    'cream': ('Cream (malai)', {'tbsp': 15}),
    'butter': ('Butter (makhan)', {'tbsp': 14}),
    'milkpowder': ('Milk powder', {'tbsp': 8}),
    'condensed': ('Condensed milk', {'tbsp': 19}),
    'cheddar': ('Cheddar cheese', {}),
    # fats
    'oil': ('Canola oil', {'tbsp': 14, 'tsp': 4.5}),
    'sunoil': ('Sunflower oil', {'tbsp': 14}),
    'olive': ('Olive oil', {'tbsp': 14, 'tsp': 4.5}),
    'ghee': ('Desi ghee', {'tbsp': 13, 'tsp': 4.3}),
    # nuts and seeds
    'almonds': ('Almonds (badam)', {'piece': 1.2, 'tbsp': 9}),
    'pistachios': ('Pistachios (pista)', {'tbsp': 8}),
    'cashews': ('Cashews (kaju)', {'tbsp': 9}),
    'walnuts': ('Walnuts (akhrot)', {'tbsp': 7}),
    'coconut': ('Desiccated coconut (khopra)', {'tbsp': 5}),
    'sesame': ('Sesame seeds (til)', {'tbsp': 9, 'tsp': 3}),
    'flax': ('Flaxseed (alsi)', {'tbsp': 10}),
    # spices and herbs
    'salt': ('Salt (namak)', {'tsp': 6}),
    'redchilli': ('Red chilli powder (lal mirch)', {'tsp': 2.5}),
    'haldi': ('Turmeric (haldi)', {'tsp': 3}),
    'zeera': ('Cumin seeds (zeera)', {'tsp': 2}),
    'dhaniya': ('Coriander seeds (dhaniya)', {'tsp': 2}),
    'pepper': ('Black pepper (kali mirch)', {'tsp': 2.5}),
    'saunf': ('Fennel seeds (saunf)', {'tsp': 2}),
    'methidana': ('Fenugreek seeds (methi dana)', {'tsp': 3.5}),
    'rai': ('Mustard seeds (rai)', {'tsp': 3.5}),
    'elaichi': ('Green cardamom (elaichi)', {'pod': 0.2, 'tsp': 2}),
    'darchini': ('Cinnamon (darchini)', {'inch': 1, 'tsp': 2.5}),
    'laung': ('Cloves (laung)', {'piece': 0.1}),
    'tezpatta': ('Bay leaf (tez patta)', {'piece': 0.2}),
    'kalonji': ('Black seed (kalonji)', {'tsp': 2.5}),
    'saffron': ('Saffron (zafran)', {'pinch': 0.1}),
    # sweeteners and condiments
    'sugar': ('Sugar (cheeni)', {'tsp': 4, 'tbsp': 12.5, 'cup': 200}),
    'shakkar': ('Brown sugar (shakkar)', {'tbsp': 12}),
    'honey': ('Honey (shehad)', {'tsp': 7, 'tbsp': 21}),
    'vinegar': ('Vinegar (sirka)', {'tbsp': 15}),
    'tomatopaste': ('Tomato paste', {'tbsp': 16}),
    'ketchup': ('Tomato ketchup', {'tbsp': 17}),
    'soysauce': ('Soy sauce', {'tbsp': 16}),
    'mayo': ('Mayonnaise', {'tbsp': 14}),
    'tea': ('Black tea, brewed (chai)', {'cup': 237}),
    'water': ('Water', {'cup': 237}),
}

STD = ['PK-PB', 'PK', 'south_asia']

# ---------------------------------------------------------------------------------------------------
# Recipes. Fields: title, meal types, servings, prep min, cook min, cost tier (1 budget .. 3 premium),
# flags (k = kid_friendly, a = autism_friendly (plain, predictable, single-texture), r = ramadan_suitable),
# textures, colours, ingredients ("[*]alias qty unit [; prep note]", * = optional, excluded from
# nutrition), steps ("text [N]" where [N] sets timer_min), region tags (default PK-PB).
# ---------------------------------------------------------------------------------------------------
R = []


def rec(title, meals, servings, prep, cook, cost, flags, textures, colors, ings, steps, region=None, kind=None):
    R.append(dict(title=title, meals=meals, servings=servings, prep=prep, cook=cook, cost=cost,
                  flags=flags, textures=textures, colors=colors, ings=ings, steps=steps,
                  region=region or STD, kind=kind))


SPICE_BASE = ['salt 1.5 tsp', 'redchilli 1 tsp', 'haldi 0.5 tsp', 'dhaniya 1 tsp']

# ---- daals and legumes (13) -------------------------------------------------------------------------
rec('Masoor daal', ['lunch', 'dinner'], 4, 10, 30, 1, 'k', ['soft', 'wet'], ['orange', 'yellow'],
    ['masoor 1 cup; washed and soaked 20 min', 'onion 1 medium; thinly sliced', 'tomato 1 medium; chopped',
     'garlic 1 tbsp paste', 'ginger 1 tbsp paste', 'salt 1.25 tsp', 'redchilli 0.75 tsp', 'haldi 0.5 tsp',
     'zeera 1 tsp', 'oil 2 tbsp', '*coriander 1 handful; chopped', '*chilli 2 piece; slit'],
    ['Boil the daal in 4 cups of water with turmeric, salt, chilli powder, ginger and garlic until soft. [25]',
     'Add the tomato and simmer until it melts into the daal, adding water for a pouring consistency. [5]',
     'For the tarka, fry the onion in oil until golden, add the cumin for a few seconds and pour over the daal.',
     'Finish with coriander and green chillies.'])
rec('Chana daal tarka', ['lunch', 'dinner'], 4, 10, 45, 1, '', ['soft', 'wet'], ['yellow'],
    ['chanadaal 1 cup; soaked 1 hour', 'onion 1 medium; sliced', 'tomato 1 medium; chopped',
     'garlic 1 tbsp paste', 'ginger 1 tbsp paste', 'salt 1.25 tsp', 'redchilli 1 tsp', 'haldi 0.5 tsp',
     'zeera 1 tsp', 'oil 3 tbsp', '*coriander 1 handful'],
    ['Pressure-cook or boil the soaked daal with turmeric, salt and 4 cups of water until soft but holding shape. [35]',
     'Fry ginger, garlic and tomato with chilli powder in half the oil until the oil separates, then add the daal. [8]',
     'Fry the onion golden in the remaining oil with cumin and pour over as tarka.'])
rec('Daal mash (Lahori dry)', ['lunch', 'dinner'], 4, 10, 40, 1, '', ['soft', 'dry'], ['beige'],
    ['mash 1 cup; soaked 2 hours', 'onion 1 medium; sliced', 'garlic 1 tbsp paste', 'ginger 1 inch; julienned',
     'salt 1.25 tsp', 'redchilli 0.75 tsp', 'haldi 0.25 tsp', 'zeera 1 tsp', 'ghee 2 tbsp', 'chilli 2 piece',
     '*coriander 1 handful'],
    ['Simmer the soaked daal with salt, turmeric, chilli powder and garlic in just enough water until each grain is soft but separate. [30]',
     'Let any water dry off on low heat. [5]',
     'Fry the onion golden in ghee with cumin, pour over and top with ginger, green chilli and coriander.'])
rec('Moong daal', ['lunch', 'dinner'], 4, 5, 30, 1, 'ka', ['smooth', 'wet'], ['yellow'],
    ['moong 1 cup; washed', 'garlic 1 tbsp paste', 'salt 1 tsp', 'haldi 0.5 tsp', 'zeera 1 tsp', 'ghee 1 tbsp'],
    ['Boil the moong with turmeric, salt, garlic and 5 cups of water until completely soft. [25]',
     'Whisk to a smooth consistency.', 'Temper cumin in ghee and stir it through.'])
rec('Mixed daal', ['lunch', 'dinner'], 5, 10, 40, 1, '', ['soft', 'wet'], ['yellow', 'orange'],
    ['masoor 0.33 cup', 'moong 0.33 cup', 'chanadaal 0.33 cup; soaked 1 hour', 'onion 1 medium',
     'tomato 2 medium', 'garlic 1 tbsp paste', 'ginger 1 tbsp paste', 'salt 1.5 tsp', 'redchilli 1 tsp',
     'haldi 0.5 tsp', 'zeera 1 tsp', 'oil 3 tbsp', '*coriander 1 handful'],
    ['Boil the three daals together with turmeric, salt and 5 cups of water until soft. [35]',
     'Make a masala of onion, ginger, garlic, tomato and chilli powder in oil and stir into the daal. [10]',
     'Temper cumin in a little oil, pour over and garnish with coriander.'])
rec('Lauki chana daal', ['lunch', 'dinner'], 4, 15, 45, 1, '', ['soft', 'wet'], ['yellow', 'green'],
    ['chanadaal 0.75 cup; soaked 1 hour', 'lauki 400 g; peeled and cubed', 'onion 1 medium', 'tomato 1 medium',
     'garlic 1 tbsp paste', 'ginger 1 tbsp paste', 'salt 1.25 tsp', 'redchilli 1 tsp', 'haldi 0.5 tsp',
     'oil 3 tbsp', '*coriander 1 handful'],
    ['Boil the daal with turmeric until half done. [20]',
     'Make a masala of onion, ginger, garlic, tomato and spices, add the lauki and cook covered for 5 minutes.',
     'Add the daal with its water and simmer until lauki is tender and the daal soft. [20]'])
rec('Palak daal', ['lunch', 'dinner'], 4, 10, 35, 1, '', ['soft', 'wet'], ['green', 'yellow'],
    ['masoor 1 cup', 'spinach 1 bunch; chopped', 'onion 1 medium', 'tomato 1 medium', 'garlic 1 tbsp paste',
     'salt 1.25 tsp', 'redchilli 0.75 tsp', 'haldi 0.5 tsp', 'zeera 1 tsp', 'oil 2 tbsp'],
    ['Boil the daal with turmeric and salt until soft. [20]',
     'Fry onion, garlic and tomato with chilli, add the spinach and cook until wilted. [8]',
     'Combine with the daal and simmer 5 minutes, then temper with cumin.'])
rec('Sabut masoor', ['lunch', 'dinner'], 4, 10, 50, 1, '', ['soft', 'wet'], ['brown'],
    ['sabutmasoor 1 cup; soaked 2 hours', 'onion 1 medium', 'tomato 1 medium', 'garlic 1 tbsp paste',
     'ginger 1 tbsp paste', 'salt 1.25 tsp', 'redchilli 1 tsp', 'haldi 0.5 tsp', 'dhaniya 1 tsp', 'oil 3 tbsp',
     '*coriander 1 handful'],
    ['Make a masala of onion, ginger, garlic, tomato and spices in oil. [10]',
     'Add the soaked lentils and 4 cups of water and simmer until soft. [40]', 'Garnish with coriander.'])
rec('Lobia masala', ['lunch', 'dinner'], 4, 10, 45, 1, '', ['soft', 'wet'], ['beige', 'red'],
    ['lobia 1 cup; soaked overnight', 'onion 1 medium', 'tomato 2 medium', 'garlic 1 tbsp paste',
     'ginger 1 tbsp paste'] + SPICE_BASE + ['oil 3 tbsp', '*coriander 1 handful'],
    ['Boil the soaked beans until tender. [30]',
     'Make a masala of onion, ginger, garlic, tomato and spices in oil until the oil separates. [10]',
     'Add the beans with some cooking water and simmer to a thick gravy. [10]'])
rec('Rajma masala', ['lunch', 'dinner'], 4, 10, 60, 1, '', ['soft', 'wet'], ['red'],
    ['rajma 1 cup; soaked overnight', 'onion 1 medium', 'tomato 2 medium', 'garlic 1 tbsp paste',
     'ginger 1 tbsp paste'] + SPICE_BASE + ['zeera 1 tsp', 'oil 3 tbsp'],
    ['Boil the soaked beans until fully soft, at least 45 minutes (never undercook kidney beans). [45]',
     'Fry cumin, onion, ginger, garlic, tomato and spices until thick. [10]',
     'Add the beans and simmer, mashing a few to thicken the gravy. [10]'])
rec('Lahori chanay', ['breakfast', 'lunch'], 6, 10, 60, 1, '', ['soft', 'wet'], ['brown'],
    ['kabuli 1.5 cup; soaked overnight', 'onion 2 medium', 'tomato 2 medium', 'garlic 1 tbsp paste',
     'ginger 1 tbsp paste', 'salt 2 tsp', 'redchilli 1.5 tsp', 'haldi 0.5 tsp', 'dhaniya 2 tsp', 'zeera 1 tsp',
     'pepper 0.5 tsp', 'oil 4 tbsp', '*coriander 1 handful', '*chilli 2 piece'],
    ['Boil the chickpeas until very soft. [45]',
     'Fry the onion golden, add ginger, garlic, tomato and all spices and cook down. [10]',
     'Add the chickpeas with water and simmer, mashing some to give the thick Lahori gravy. [15]'])
rec('Daal gosht', ['lunch', 'dinner'], 6, 15, 90, 3, '', ['soft', 'wet'], ['yellow', 'brown'],
    ['mutton 500 g bone-in; pieces', 'chanadaal 1 cup; soaked 1 hour', 'onion 2 medium', 'tomato 2 medium',
     'garlic 1.5 tbsp paste', 'ginger 1.5 tbsp paste', 'salt 2 tsp', 'redchilli 1.5 tsp', 'haldi 0.5 tsp',
     'dhaniya 2 tsp', 'oil 4 tbsp', '*coriander 1 handful'],
    ['Fry the onion golden, add the meat, ginger and garlic and brown well. [10]',
     'Add tomato and spices, then water, and cook until the meat is nearly tender. [45]',
     'Add the soaked daal and cook until soft and the gravy thick. [30]'])
rec('Haleem', ['lunch', 'dinner', 'iftar'], 8, 30, 240, 3, 'r', ['smooth', 'lumpy'], ['brown'],
    ['beef 500 g; boneless', 'daliya 0.5 cup', 'jau 0.25 cup', 'chanadaal 0.25 cup', 'masoor 0.25 cup',
     'moong 0.25 cup', 'mash 0.25 cup', 'onion 3 medium; sliced', 'garlic 2 tbsp paste', 'ginger 2 tbsp paste',
     'salt 2.5 tsp', 'redchilli 2 tsp', 'haldi 1 tsp', 'dhaniya 2 tsp', 'oil 6 tbsp', '*lemon 2 juiced',
     '*mint 1 handful', '*ginger 1 inch; julienned for garnish', '*chilli 3 piece'],
    ['Soak the wheat, barley and lentils overnight.',
     'Boil the grains and lentils in plenty of water until completely soft. [90]',
     'Cook the meat with half the onion, ginger, garlic and spices until falling apart. [90]',
     'Combine and cook on low heat, stirring and beating with a ghotna until stringy and smooth. [45]',
     'Top with the remaining onion fried crisp, mint, ginger, green chilli and lemon.'])

# ---- vegetables (17) ----------------------------------------------------------------------------------
VEG_BASE = ['onion 1 medium', 'tomato 1 medium', 'garlic 1 tbsp paste', 'ginger 0.5 tbsp paste']
rec('Aloo gobhi', ['lunch', 'dinner'], 4, 10, 25, 1, 'k', ['soft'], ['yellow', 'white'],
    ['gobhi 500 g; florets', 'potato 2 medium; cubed'] + VEG_BASE + SPICE_BASE + ['zeera 1 tsp', 'oil 3 tbsp',
                                                                                  '*coriander 1 handful'],
    ['Fry cumin and onion, add ginger, garlic, tomato and spices and cook down. [6]',
     'Add the potato and cauliflower, cover and cook on low heat without water until tender. [18]',
     'Garnish with coriander.'])
rec('Aloo matar', ['lunch', 'dinner'], 4, 10, 25, 1, 'k', ['soft', 'wet'], ['green', 'yellow'],
    ['potato 3 medium; cubed', 'peas 1 cup'] + VEG_BASE + SPICE_BASE + ['oil 3 tbsp', '*coriander 1 handful'],
    ['Cook a masala of onion, ginger, garlic, tomato and spices. [8]',
     'Add potatoes, peas and 1.5 cups of water and simmer until the potatoes are soft. [15]'])
rec('Aloo palak', ['lunch', 'dinner'], 4, 10, 25, 1, '', ['soft'], ['green'],
    ['spinach 2 bunch; chopped', 'potato 2 medium; cubed'] + VEG_BASE + ['salt 1.25 tsp', 'redchilli 0.75 tsp',
                                                                          'haldi 0.25 tsp', 'oil 3 tbsp'],
    ['Cook onion, garlic, ginger and tomato with spices. [6]', 'Add potato and cook covered until half done. [8]',
     'Add spinach and cook until the moisture dries. [10]'])
rec('Bhindi masala', ['lunch', 'dinner'], 4, 15, 25, 1, '', ['soft'], ['green'],
    ['bhindi 500 g; washed, dried and cut', 'onion 2 medium; sliced', 'tomato 1 medium', 'salt 1.25 tsp',
     'redchilli 1 tsp', 'haldi 0.5 tsp', 'dhaniya 1 tsp', 'oil 4 tbsp', '*lemon 1 juiced'],
    ['Fry the okra in oil until it is no longer sticky, then remove. [10]',
     'In the same pan cook the onion soft, add tomato and spices. [6]',
     'Return the okra, toss and cook on low heat for 8 minutes. Finish with lemon.'])
rec('Karela pyaz', ['lunch', 'dinner'], 4, 30, 30, 1, '', ['soft', 'crunchy'], ['green', 'brown'],
    ['karela 400 g; scraped, sliced, salted 30 min and squeezed', 'onion 3 medium; sliced', 'tomato 1 medium',
     'salt 1 tsp', 'redchilli 1 tsp', 'haldi 0.5 tsp', 'dhaniya 1 tsp', 'oil 4 tbsp'],
    ['Fry the squeezed karela in oil until golden. [10]', 'Add the onion and cook until soft and brown. [10]',
     'Add tomato and spices and cook on low heat until dry. [10]'])
rec('Lauki ki sabzi', ['lunch', 'dinner'], 4, 10, 25, 1, 'ka', ['soft', 'wet'], ['green'],
    ['lauki 700 g; peeled and cubed'] + VEG_BASE + ['salt 1 tsp', 'redchilli 0.5 tsp', 'haldi 0.5 tsp',
                                                     'oil 2 tbsp', '*coriander 1 handful'],
    ['Cook onion, garlic, ginger and tomato with spices. [6]',
     'Add the lauki, cover and cook in its own water until translucent. [18]'])
rec('Tori ki sabzi', ['lunch', 'dinner'], 4, 10, 25, 1, '', ['soft', 'wet'], ['green'],
    ['tori 600 g; peeled and sliced'] + VEG_BASE + ['salt 1 tsp', 'redchilli 0.75 tsp', 'haldi 0.5 tsp',
                                                     'oil 2 tbsp'],
    ['Cook the masala of onion, garlic, ginger, tomato and spices. [6]',
     'Add the tori and cook covered on low heat until soft. [15]'])
rec('Khatta meetha kaddu', ['lunch', 'dinner'], 4, 10, 25, 1, 'k', ['soft'], ['orange'],
    ['kaddu 700 g; peeled and cubed', 'onion 1 medium', 'salt 1 tsp', 'redchilli 0.75 tsp', 'haldi 0.25 tsp',
     'methidana 0.5 tsp', 'saunf 1 tsp', 'tamarind 15 g; soaked and strained', 'shakkar 1 tbsp', 'oil 2 tbsp'],
    ['Splutter fenugreek and fennel in oil, add the onion and fry soft. [5]',
     'Add the pumpkin and spices, cover and cook until soft enough to mash. [15]',
     'Stir in tamarind and shakkar and cook 3 minutes.'])
rec('Baingan bharta', ['lunch', 'dinner'], 4, 10, 30, 1, '', ['smooth', 'soft'], ['purple', 'brown'],
    ['baingan 600 g; large', 'onion 1 medium', 'tomato 2 medium', 'garlic 1 tbsp paste', 'chilli 2 piece',
     'salt 1.25 tsp', 'redchilli 0.5 tsp', 'zeera 1 tsp', 'oil 2 tbsp', '*coriander 1 handful'],
    ['Roast the eggplant over an open flame until charred and soft, then peel and mash. [15]',
     'Fry cumin, onion, garlic and green chilli, add tomatoes and cook down. [8]',
     'Add the mashed eggplant and spices and cook 5 minutes.'])
rec('Shalgam ki sabzi', ['lunch', 'dinner'], 4, 10, 30, 1, '', ['soft'], ['white', 'brown'],
    ['shalgam 600 g; peeled and cubed'] + VEG_BASE + ['salt 1.25 tsp', 'redchilli 1 tsp', 'haldi 0.5 tsp',
                                                       'shakkar 1 tbsp', 'oil 3 tbsp'],
    ['Cook the masala with spices. [6]', 'Add the turnip, cover and cook until soft enough to mash. [20]',
     'Mash lightly and stir in shakkar.'])
rec('Arvi masala', ['lunch', 'dinner'], 4, 15, 25, 1, '', ['soft'], ['beige'],
    ['arvi 500 g; boiled, peeled and sliced', 'onion 1 medium', 'salt 1 tsp', 'redchilli 1 tsp', 'haldi 0.5 tsp',
     'zeera 1 tsp', 'oil 3 tbsp', 'lemon 1 juiced'],
    ['Boil the arvi until just tender, peel and slice. [15]',
     'Fry cumin and onion, add spices and the arvi and toss until lightly crisp. [10]', 'Finish with lemon.'])
rec('Sarson ka saag', ['lunch', 'dinner'], 6, 20, 90, 1, '', ['smooth'], ['green'],
    ['sarson 1000 g; chopped', 'spinach 1 bunch; chopped', 'makaiatta 3 tbsp', 'garlic 2 tbsp paste',
     'ginger 1 tbsp paste', 'chilli 3 piece', 'salt 2 tsp', 'onion 1 medium', 'ghee 3 tbsp', '*butter 2 tbsp'],
    ['Boil the greens with ginger, half the garlic, green chilli and salt until very soft. [60]',
     'Mash or blend coarsely and cook in the maize flour until it thickens. [15]',
     'Fry onion and the remaining garlic in ghee and stir through. Serve with makai ki roti.'])
rec('Mix sabzi', ['lunch', 'dinner'], 4, 15, 25, 1, 'k', ['soft', 'mixed'], ['green', 'orange'],
    ['potato 1 medium', 'carrot 2 medium', 'peas 0.5 cup', 'gobhi 200 g', 'capsicum 1 medium'] + VEG_BASE +
    SPICE_BASE + ['oil 3 tbsp'],
    ['Cook the masala with spices. [6]', 'Add the potato and carrot and cook covered 8 minutes.',
     'Add the cauliflower, peas and capsicum and cook until all are tender. [10]'])
rec('Shimla mirch aloo', ['lunch', 'dinner'], 4, 10, 20, 1, 'k', ['soft', 'crunchy'], ['green', 'yellow'],
    ['capsicum 3 medium', 'potato 2 medium'] + VEG_BASE + SPICE_BASE + ['oil 3 tbsp'],
    ['Cook the masala with spices. [6]', 'Add the potatoes and cook covered until nearly done. [10]',
     'Add the capsicum and cook 5 minutes so it keeps some bite.'])
rec('Gajar matar', ['lunch', 'dinner'], 4, 10, 20, 1, 'k', ['soft'], ['orange', 'green'],
    ['carrot 5 medium; diced', 'peas 1 cup', 'onion 1 medium', 'salt 1 tsp', 'redchilli 0.5 tsp',
     'haldi 0.25 tsp', 'zeera 1 tsp', 'oil 2 tbsp'],
    ['Fry cumin and onion. [4]', 'Add carrots, peas and spices, cover and cook until tender. [15]'])
rec('Band gobhi matar', ['lunch', 'dinner'], 4, 10, 20, 1, '', ['soft', 'crunchy'], ['green'],
    ['cabbage 500 g; shredded', 'peas 0.75 cup', 'onion 1 medium', 'tomato 1 medium', 'salt 1 tsp',
     'redchilli 0.75 tsp', 'haldi 0.5 tsp', 'zeera 1 tsp', 'oil 3 tbsp'],
    ['Fry cumin, onion and tomato with spices. [6]', 'Add peas and cabbage and stir-fry covered until just tender. [12]'])
rec('Aloo ka salan', ['lunch', 'dinner'], 4, 10, 25, 1, 'k', ['soft', 'wet'], ['red', 'yellow'],
    ['potato 4 medium; cubed', 'onion 1 medium', 'tomato 2 medium', 'garlic 1 tbsp paste'] + SPICE_BASE +
    ['zeera 1 tsp', 'oil 3 tbsp', '*coriander 1 handful'],
    ['Cook onion, garlic, tomato and spices until the oil separates. [8]',
     'Add the potatoes and 2 cups of water and simmer until soft with a thin gravy. [15]'])

# ---- chicken (12) ------------------------------------------------------------------------------------
CH_BASE = ['chicken 1000 g bone-in; curry cut']
rec('Chicken karahi', ['lunch', 'dinner'], 5, 15, 35, 2, '', ['soft', 'wet'], ['red'],
    CH_BASE + ['tomato 5 medium; chopped', 'garlic 1.5 tbsp paste', 'ginger 1.5 tbsp paste', 'salt 2 tsp',
               'redchilli 1.5 tsp', 'pepper 0.5 tsp', 'zeera 1 tsp', 'oil 5 tbsp', 'chilli 4 piece',
               '*ginger 1 inch; julienned', '*coriander 1 handful'],
    ['Fry the chicken with ginger and garlic in oil on high heat until it changes colour. [8]',
     'Add the tomatoes, salt and chilli powder, cover and cook until the tomatoes are soft. [12]',
     'Uncover and bhuno on high heat until the oil separates; add cumin, pepper and green chilli. [10]',
     'Garnish with ginger and coriander.'])
rec('Chicken salan', ['lunch', 'dinner'], 5, 15, 40, 2, 'k', ['soft', 'wet'], ['red', 'brown'],
    CH_BASE + ['onion 2 medium', 'tomato 2 medium', 'garlic 1 tbsp paste', 'ginger 1 tbsp paste',
               'yogurt 0.5 cup', 'salt 2 tsp', 'redchilli 1.5 tsp', 'haldi 0.5 tsp', 'dhaniya 2 tsp',
               'oil 5 tbsp', '*coriander 1 handful'],
    ['Fry the onion golden, add ginger, garlic and chicken and brown. [10]',
     'Add tomato, yogurt and spices and bhuno until the oil separates. [12]',
     'Add 2 cups of water and simmer until the chicken is tender. [15]'])
rec('Aloo murgh', ['lunch', 'dinner'], 5, 15, 40, 2, 'k', ['soft', 'wet'], ['red', 'yellow'],
    CH_BASE + ['potato 3 medium; halved', 'onion 2 medium', 'tomato 2 medium', 'garlic 1 tbsp paste',
               'ginger 1 tbsp paste', 'salt 2 tsp', 'redchilli 1.5 tsp', 'haldi 0.5 tsp', 'dhaniya 2 tsp',
               'oil 5 tbsp'],
    ['Make the salan base of onion, ginger, garlic, chicken, tomato and spices. [20]',
     'Add potatoes and 3 cups of water and simmer until the potatoes are soft. [20]'])
rec('Chicken qorma', ['lunch', 'dinner'], 5, 15, 45, 2, '', ['soft', 'wet'], ['brown'],
    CH_BASE + ['onion 3 medium; sliced and fried brown', 'yogurt 1 cup', 'garlic 1 tbsp paste',
               'ginger 1 tbsp paste', 'salt 2 tsp', 'redchilli 1.5 tsp', 'dhaniya 2 tsp', 'elaichi 4 pod',
               'laung 4 piece', 'darchini 1 inch', 'tezpatta 2 piece', 'oil 6 tbsp', '*almonds 10 piece'],
    ['Fry the whole spices in oil, add the chicken with ginger and garlic and brown. [10]',
     'Crush the fried onion into the yogurt with the ground spices and add to the pot. [5]',
     'Cook covered on low heat until the chicken is tender and the oil rises. [25]',
     'Simmer briefly on dum and garnish with almonds.'])
rec('Chicken biryani', ['lunch', 'dinner'], 6, 30, 60, 2, '', ['soft', 'mixed'], ['yellow', 'white'],
    CH_BASE + ['rice 2.5 cup; soaked 30 min', 'onion 3 medium; sliced', 'tomato 3 medium', 'yogurt 1 cup',
               'garlic 1.5 tbsp paste', 'ginger 1.5 tbsp paste', 'salt 3 tsp', 'redchilli 2 tsp', 'haldi 0.5 tsp',
               'dhaniya 2 tsp', 'zeera 1 tsp', 'elaichi 5 pod', 'laung 6 piece', 'darchini 1 inch',
               'tezpatta 2 piece', 'oil 7 tbsp', 'mint 1 handful', 'coriander 1 handful', 'chilli 4 piece',
               'lemon 1 juiced', '*potato 2 medium', '*saffron 1 pinch'],
    ['Fry the onion golden and remove half for layering.', 'Cook the chicken with ginger, garlic, tomato, yogurt and spices to a thick korma. [25]',
     'Boil the rice with whole spices and salt until 70 percent done and drain. [8]',
     'Layer rice over the chicken with fried onion, mint, coriander, green chilli and lemon.',
     'Seal and cook on dum on very low heat. [20]'])
rec('Chicken yakhni pulao', ['lunch', 'dinner'], 6, 20, 70, 2, 'k', ['soft'], ['white', 'beige'],
    CH_BASE + ['rice 2.5 cup; soaked 30 min', 'onion 2 medium; sliced', 'garlic 1 tbsp paste',
               'ginger 1 tbsp paste', 'salt 3 tsp', 'saunf 1 tsp', 'dhaniya 2 tsp', 'zeera 1 tsp',
               'pepper 0.5 tsp', 'elaichi 4 pod', 'laung 5 piece', 'darchini 1 inch', 'tezpatta 2 piece',
               'oil 6 tbsp', 'yogurt 0.5 cup'],
    ['Boil the chicken with ginger, garlic, fennel, coriander seeds and salt in 6 cups of water for the yakhni; strain. [35]',
     'Fry the onion golden with the whole spices, add the chicken and yogurt and fry. [8]',
     'Add 4.5 cups of yakhni and the drained rice and boil until the water is absorbed. [12]',
     'Cover and steam on dum. [15]'])
rec('Chicken tikka (tawa)', ['lunch', 'dinner'], 4, 130, 25, 2, '', ['chewy'], ['red'],
    ['thigh 700 g; cubed', 'yogurt 0.5 cup', 'garlic 1 tbsp paste', 'ginger 1 tbsp paste', 'salt 1.5 tsp',
     'redchilli 1.5 tsp', 'haldi 0.25 tsp', 'zeera 1 tsp', 'dhaniya 1 tsp', 'lemon 1 juiced', 'oil 2 tbsp',
     '*onion 1 medium; rings to serve'],
    ['Marinate the chicken in yogurt, ginger, garlic, lemon and spices for at least 2 hours. [120]',
     'Cook on a hot tawa or under the grill, turning, until charred at the edges and cooked through. [20]'])
rec('Chicken jalfrezi', ['lunch', 'dinner'], 4, 15, 25, 2, '', ['crunchy', 'soft'], ['red', 'green'],
    ['breast 600 g; strips', 'capsicum 2 medium', 'onion 2 medium; cubed', 'tomato 2 medium',
     'tomatopaste 1 tbsp', 'garlic 1 tbsp paste', 'ginger 1 tbsp paste', 'salt 1.5 tsp', 'redchilli 1 tsp',
     'haldi 0.25 tsp', 'pepper 0.5 tsp', 'vinegar 1 tbsp', 'oil 3 tbsp'],
    ['Stir-fry the chicken with ginger and garlic until white. [6]',
     'Add tomato, tomato paste, spices and vinegar and cook down. [8]',
     'Add onion and capsicum and toss on high heat so they stay crunchy. [5]'])
rec('Palak murgh', ['lunch', 'dinner'], 5, 15, 40, 2, '', ['soft', 'wet'], ['green'],
    CH_BASE + ['spinach 2 bunch; blanched and chopped', 'onion 2 medium', 'tomato 2 medium',
               'garlic 1 tbsp paste', 'ginger 1 tbsp paste', 'salt 2 tsp', 'redchilli 1 tsp',
               'haldi 0.5 tsp', 'dhaniya 2 tsp', 'oil 5 tbsp'],
    ['Make the salan base of onion, ginger, garlic, chicken, tomato and spices. [20]',
     'Add the spinach and cook until the chicken is tender and the masala thick. [15]'])
rec('Chicken kaleji masala', ['lunch', 'dinner'], 4, 10, 15, 1, '', ['soft'], ['brown'],
    ['chickenliver 500 g; cleaned', 'onion 2 medium', 'tomato 2 medium', 'garlic 1 tbsp paste',
     'ginger 1 tbsp paste', 'salt 1.5 tsp', 'redchilli 1 tsp', 'haldi 0.25 tsp', 'pepper 0.5 tsp',
     'oil 3 tbsp', '*coriander 1 handful'],
    ['Fry onion, garlic, ginger and tomato with spices until soft. [6]',
     'Add the liver and cook on medium-high heat only until no longer pink inside. [8]'])
rec('Chicken vegetable soup', ['dinner', 'iftar'], 4, 10, 30, 2, 'kar', ['wet'], ['yellow'],
    ['breast 250 g', 'carrot 1 medium', 'cabbage 100 g', 'springonion 0.5 bunch', 'garlic 1 tbsp paste',
     'ginger 0.5 tbsp paste', 'cornflour 2 tbsp', 'egg 1 piece', 'salt 1.25 tsp', 'pepper 0.5 tsp',
     'soysauce 1 tbsp', '*vinegar 1 tbsp'],
    ['Boil the chicken with ginger, garlic and 6 cups of water for stock, then shred the chicken. [20]',
     'Add the finely cut vegetables, salt, pepper and soy sauce and simmer 5 minutes.',
     'Thicken with cornflour mixed in cold water and drizzle in the beaten egg while stirring.'])
rec('Chapli kabab', ['lunch', 'dinner'], 5, 20, 20, 2, '', ['crispy', 'chewy'], ['brown'],
    ['mince 500 g', 'onion 1 medium; finely chopped', 'tomato 1 medium; finely chopped',
     'egg 1 piece', 'maida 2 tbsp', 'chilli 3 piece', 'coriander 1 handful', 'dhaniya 2 tsp', 'zeera 1 tsp',
     'redchilli 1 tsp', 'salt 1.5 tsp', 'oil 4 tbsp'],
    ['Mix all ingredients except oil and rest 15 minutes. [15]',
     'Shape into flat round kababs and shallow-fry in oil until browned on both sides and cooked through. [15]'],
    region=['PK-KP', 'PK-PB', 'PK', 'south_asia'])

# ---- beef and mutton (11) -----------------------------------------------------------------------------
rec('Qeema matar', ['lunch', 'dinner'], 4, 10, 30, 2, 'k', ['soft', 'lumpy'], ['brown', 'green'],
    ['mince 500 g', 'peas 1 cup', 'onion 1 medium', 'tomato 2 medium', 'garlic 1 tbsp paste',
     'ginger 1 tbsp paste', 'yogurt 3 tbsp'] + SPICE_BASE + ['oil 3 tbsp', '*coriander 1 handful'],
    ['Fry onion golden, add mince with ginger and garlic and cook until the water dries. [10]',
     'Add tomato, yogurt and spices and bhuno. [8]', 'Add peas with a little water and cook until tender. [10]'])
rec('Aloo qeema', ['lunch', 'dinner'], 4, 10, 30, 2, 'k', ['soft', 'lumpy'], ['brown'],
    ['mince 400 g', 'potato 2 medium; small cubes', 'onion 1 medium', 'tomato 2 medium', 'garlic 1 tbsp paste',
     'ginger 1 tbsp paste'] + SPICE_BASE + ['oil 3 tbsp'],
    ['Cook the mince with onion, ginger and garlic until dry. [10]', 'Add tomato and spices and bhuno. [8]',
     'Add potatoes and a cup of water and cook until soft. [12]'])
rec('Shami kabab', ['lunch', 'dinner', 'snack'], 8, 30, 70, 2, 'k', ['soft', 'crispy'], ['brown'],
    ['beef 500 g; boneless', 'chanadaal 0.5 cup; soaked 1 hour', 'onion 1 medium', 'garlic 6 clove',
     'ginger 1 inch', 'salt 2 tsp', 'redchilli 1 tsp', 'zeera 1 tsp', 'dhaniya 1 tsp', 'pepper 0.5 tsp',
     'laung 4 piece', 'elaichi 3 pod', 'egg 2 piece', 'mint 1 handful', 'oil 4 tbsp'],
    ['Boil the beef, daal, garlic, ginger and whole spices with just enough water until the meat is tender and the water dries. [60]',
     'Grind to a smooth paste and mix in chopped onion and mint.',
     'Shape into patties, dip in beaten egg and shallow-fry until golden. [10]'])
rec('Beef nihari', ['breakfast', 'lunch', 'dinner'], 6, 15, 240, 3, '', ['soft', 'wet'], ['brown', 'red'],
    ['beef 1000 g bone-in; shank pieces', 'onion 1 medium', 'garlic 1.5 tbsp paste', 'ginger 1.5 tbsp paste',
     'atta 4 tbsp; dry-roasted', 'salt 2.5 tsp', 'redchilli 2 tsp', 'haldi 0.5 tsp', 'dhaniya 2 tsp',
     'saunf 1 tsp', 'zeera 1 tsp', 'pepper 0.5 tsp', 'darchini 1 inch', 'laung 6 piece', 'elaichi 4 pod',
     'oil 8 tbsp', '*ginger 1 inch; julienned', '*lemon 1 juiced', '*chilli 3 piece', '*coriander 1 handful'],
    ['Fry the onion, add the meat with ginger, garlic and the ground spices and brown. [15]',
     'Add 8 cups of water and simmer very slowly, covered, until the meat is tender. [180]',
     'Whisk the roasted flour in water and stir in to thicken; simmer 20 minutes. [20]',
     'Serve with ginger, green chilli, coriander and lemon.'])
rec('Aloo gosht', ['lunch', 'dinner'], 5, 15, 75, 3, '', ['soft', 'wet'], ['red', 'brown'],
    ['mutton 750 g bone-in; curry cut', 'potato 3 medium; halved', 'onion 2 medium', 'tomato 2 medium',
     'garlic 1.5 tbsp paste', 'ginger 1.5 tbsp paste', 'yogurt 0.5 cup', 'salt 2 tsp', 'redchilli 1.5 tsp',
     'haldi 0.5 tsp', 'dhaniya 2 tsp', 'oil 5 tbsp'],
    ['Fry onion golden, add mutton, ginger and garlic and brown. [12]',
     'Add tomato, yogurt and spices and bhuno until the oil separates. [12]',
     'Add water and cook until the mutton is nearly tender, then add potatoes and cook until soft. [50]'])
rec('Mutton karahi', ['lunch', 'dinner'], 5, 15, 60, 3, '', ['soft', 'wet'], ['red'],
    ['mutton 1000 g bone-in; small pieces', 'tomato 5 medium', 'garlic 1.5 tbsp paste', 'ginger 1.5 tbsp paste',
     'salt 2 tsp', 'redchilli 1.5 tsp', 'pepper 1 tsp', 'zeera 1 tsp', 'yogurt 0.5 cup', 'oil 6 tbsp',
     'chilli 4 piece', '*ginger 1 inch; julienned'],
    ['Sear the mutton with ginger and garlic, add a cup of water and cook covered until tender. [40]',
     'Add tomatoes and cook until they break down. [10]',
     'Add yogurt and spices and bhuno on high heat until the oil separates. [10]'])
rec('Bhindi gosht', ['lunch', 'dinner'], 5, 20, 70, 3, '', ['soft', 'wet'], ['green', 'brown'],
    ['mutton 600 g bone-in', 'bhindi 400 g; fried separately', 'onion 2 medium', 'tomato 2 medium',
     'garlic 1 tbsp paste', 'ginger 1 tbsp paste'] + SPICE_BASE + ['oil 5 tbsp'],
    ['Cook the mutton with onion, ginger, garlic, tomato and spices until tender. [55]',
     'Add the fried okra and simmer 10 minutes.'])
rec('Shalgam gosht', ['lunch', 'dinner'], 5, 20, 80, 3, '', ['soft', 'wet'], ['brown'],
    ['beef 600 g', 'shalgam 500 g; peeled and quartered', 'onion 2 medium', 'tomato 2 medium',
     'garlic 1 tbsp paste', 'ginger 1 tbsp paste'] + SPICE_BASE + ['shakkar 1 tbsp', 'oil 5 tbsp'],
    ['Cook the beef with onion, ginger, garlic, tomato and spices until nearly tender. [55]',
     'Add the turnips with water and cook until soft and the gravy thick. [20]'])
rec('Lauki gosht', ['lunch', 'dinner'], 5, 20, 70, 3, '', ['soft', 'wet'], ['green', 'brown'],
    ['mutton 600 g bone-in', 'lauki 600 g; peeled and cubed', 'onion 2 medium', 'tomato 2 medium',
     'garlic 1 tbsp paste', 'ginger 1 tbsp paste'] + SPICE_BASE + ['oil 5 tbsp'],
    ['Cook the mutton masala until the meat is nearly tender. [50]', 'Add the lauki and cook until it is translucent. [15]'])
rec('Mutton pulao', ['lunch', 'dinner'], 6, 20, 100, 3, '', ['soft'], ['beige'],
    ['mutton 750 g bone-in', 'rice 2.5 cup; soaked 30 min', 'onion 2 medium', 'garlic 1.5 tbsp paste',
     'ginger 1.5 tbsp paste', 'salt 3 tsp', 'saunf 1 tsp', 'dhaniya 2 tsp', 'zeera 1 tsp', 'pepper 0.5 tsp',
     'elaichi 4 pod', 'laung 5 piece', 'darchini 1 inch', 'tezpatta 2 piece', 'oil 6 tbsp'],
    ['Make a yakhni by boiling the mutton with ginger, garlic, fennel, coriander and salt until tender; strain. [60]',
     'Fry the onion golden with the whole spices, add the meat and fry. [8]',
     'Add 4.5 cups of yakhni and the rice, boil until absorbed and steam on dum. [30]'])
rec('Beef kaleji', ['lunch', 'dinner'], 4, 10, 20, 2, '', ['soft'], ['brown'],
    ['beefliver 500 g; cubed', 'onion 2 medium', 'tomato 2 medium', 'garlic 1 tbsp paste', 'ginger 1 tbsp paste',
     'salt 1.5 tsp', 'redchilli 1 tsp', 'haldi 0.25 tsp', 'pepper 0.5 tsp', 'oil 3 tbsp', '*lemon 1 juiced'],
    ['Cook onion, ginger, garlic and tomato with spices. [6]',
     'Add the liver and cook on medium-high heat until just cooked through; overcooking makes it tough. [12]'])

# ---- fish and seafood (4) ------------------------------------------------------------------------------
rec('Lahori fried fish', ['lunch', 'dinner', 'snack'], 4, 40, 20, 3, '', ['crispy'], ['orange'],
    ['rohu 700 g; boneless pieces', 'besan 0.5 cup', 'garlic 1 tbsp paste', 'ginger 1 tbsp paste',
     'lemon 1 juiced', 'salt 1.5 tsp', 'redchilli 1.5 tsp', 'haldi 0.25 tsp', 'zeera 1 tsp', 'dhaniya 1 tsp',
     'oil 6 tbsp'],
    ['Rub the fish with lemon and salt for 10 minutes, then rinse. [10]',
     'Coat in a thick paste of besan, ginger, garlic and spices and rest 30 minutes. [30]',
     'Shallow-fry in batches until crisp and cooked through. [15]'])
rec('Fish salan', ['lunch', 'dinner'], 4, 15, 30, 3, '', ['soft', 'wet'], ['red'],
    ['rohu 600 g; pieces', 'onion 1 medium', 'tomato 3 medium', 'garlic 1 tbsp paste', 'ginger 1 tbsp paste',
     'methidana 0.25 tsp', 'kalonji 0.25 tsp'] + SPICE_BASE + ['oil 4 tbsp', '*coriander 1 handful'],
    ['Lightly fry the fish and set aside. [8]',
     'Splutter fenugreek and nigella seeds, cook onion, ginger, garlic, tomato and spices to a masala. [10]',
     'Add 1.5 cups of water and the fish and simmer gently without stirring. [10]'])
rec('Tawa surmai', ['lunch', 'dinner'], 4, 30, 15, 3, '', ['soft'], ['red'],
    ['surmai 600 g; steaks', 'garlic 1 tbsp paste', 'lemon 1 juiced', 'salt 1.25 tsp', 'redchilli 1 tsp',
     'haldi 0.25 tsp', 'zeera 0.5 tsp', 'oil 2 tbsp'],
    ['Marinate the fish with lemon, garlic and spices. [30]', 'Cook on a hot oiled tawa 4 to 5 minutes a side. [10]'])
rec('Prawn karahi', ['lunch', 'dinner'], 4, 15, 20, 3, '', ['chewy', 'wet'], ['red', 'pink'],
    ['prawns 500 g; cleaned', 'tomato 4 medium', 'garlic 1 tbsp paste', 'ginger 1 tbsp paste', 'salt 1.5 tsp',
     'redchilli 1 tsp', 'pepper 0.5 tsp', 'zeera 1 tsp', 'oil 3 tbsp', 'chilli 3 piece', '*coriander 1 handful'],
    ['Cook ginger, garlic and tomatoes until soft and the oil separates. [12]',
     'Add the prawns and spices and cook only until pink and curled. [5]'])

# ---- eggs (4) ------------------------------------------------------------------------------------------
rec('Anday ka khagina', ['breakfast', 'suhoor'], 2, 5, 8, 1, 'k', ['soft'], ['yellow'],
    ['egg 4 piece', 'onion 0.5 medium', 'tomato 0.5 medium', 'chilli 1 piece', 'salt 0.5 tsp',
     'haldi 0.25 tsp', 'oil 1 tbsp', '*coriander 0.5 handful'],
    ['Fry onion, tomato and green chilli until soft. [4]', 'Add the beaten eggs with salt and turmeric and scramble until just set. [3]'])
rec('Masala omelette', ['breakfast', 'suhoor'], 2, 5, 6, 1, 'k', ['soft'], ['yellow'],
    ['egg 4 piece', 'onion 0.5 medium; finely chopped', 'tomato 0.5 medium; finely chopped', 'chilli 1 piece',
     'salt 0.5 tsp', 'redchilli 0.25 tsp', 'oil 1 tbsp', '*coriander 0.5 handful'],
    ['Beat the eggs with the vegetables and spices.', 'Cook in a hot oiled pan, fold and cook through. [5]'])
rec('Anda curry', ['lunch', 'dinner'], 4, 10, 25, 1, '', ['soft', 'wet'], ['red', 'yellow'],
    ['egg 6 piece; hard-boiled and peeled', 'onion 2 medium', 'tomato 2 medium', 'garlic 1 tbsp paste',
     'ginger 1 tbsp paste'] + SPICE_BASE + ['oil 3 tbsp'],
    ['Cook onion, ginger, garlic, tomato and spices to a thick masala. [12]',
     'Add 1.5 cups of water and the scored eggs and simmer. [10]'])
rec('Boiled eggs', ['breakfast', 'suhoor', 'snack'], 2, 1, 10, 1, 'ka', ['soft'], ['white', 'yellow'],
    ['egg 4 piece', 'salt 0.25 tsp', '*pepper 0.25 tsp'],
    ['Cover the eggs with cold water, bring to the boil and simmer 9 minutes for firm yolks. [10]',
     'Cool in cold water, peel and season.'])

# ---- rice (5) ------------------------------------------------------------------------------------------
rec('Plain boiled basmati', ['lunch', 'dinner'], 4, 30, 20, 1, 'ka', ['soft'], ['white'],
    ['rice 1.5 cup; soaked 30 min', 'salt 1 tsp'],
    ['Boil the drained rice in plenty of salted water until just done. [10]', 'Drain and steam covered on low heat. [10]'])
rec('Zeera rice', ['lunch', 'dinner'], 4, 30, 25, 1, 'k', ['soft'], ['white'],
    ['rice 1.5 cup; soaked 30 min', 'zeera 1.5 tsp', 'salt 1.25 tsp', 'ghee 1.5 tbsp'],
    ['Fry the cumin in ghee, add 3 cups of water and salt and bring to the boil.',
     'Add the rice, cook until the water is absorbed, then steam on dum. [20]'])
rec('Matar pulao', ['lunch', 'dinner'], 5, 30, 35, 1, 'k', ['soft'], ['white', 'green'],
    ['rice 2 cup; soaked 30 min', 'peas 1 cup', 'onion 1 medium; sliced', 'zeera 1 tsp', 'elaichi 3 pod',
     'laung 4 piece', 'darchini 1 inch', 'tezpatta 1 piece', 'salt 2 tsp', 'oil 3 tbsp'],
    ['Fry the onion golden with the whole spices. [8]', 'Add peas, 4 cups of water and salt and boil.',
     'Add rice, cook until absorbed and steam on dum. [25]'])
rec('Chana pulao', ['lunch', 'dinner'], 5, 30, 40, 1, '', ['soft'], ['beige'],
    ['rice 2 cup; soaked 30 min', 'kabuli 0.75 cup; soaked overnight and boiled', 'onion 1 medium; sliced',
     'garlic 1 tbsp paste', 'ginger 1 tbsp paste', 'zeera 1 tsp', 'elaichi 3 pod', 'laung 4 piece',
     'tezpatta 1 piece', 'salt 2 tsp', 'oil 4 tbsp'],
    ['Fry onion golden with the whole spices, add ginger, garlic and the boiled chickpeas. [8]',
     'Add 4 cups of water and salt, then the rice; cook until absorbed and steam on dum. [25]'])
rec('Moong daal khichri', ['lunch', 'dinner'], 4, 15, 30, 1, 'ka', ['soft', 'smooth'], ['yellow'],
    ['rice 0.75 cup', 'moong 0.5 cup', 'haldi 0.5 tsp', 'salt 1.25 tsp', 'zeera 1 tsp', 'ghee 1.5 tbsp',
     '*yogurt 0.5 cup; to serve'],
    ['Wash and soak the rice and moong together for 15 minutes. [15]',
     'Cook with turmeric, salt and 4 cups of water until very soft. [25]', 'Temper cumin in ghee and stir through.'])

# ---- breads (5) ----------------------------------------------------------------------------------------
rec('Roti (chapati)', ['breakfast', 'lunch', 'dinner'], 6, 15, 15, 1, 'ka', ['chewy', 'soft'], ['beige'],
    ['atta 2.5 cup', 'salt 0.5 tsp'],
    ['Knead the flour with salt and about 1 cup of water to a soft dough and rest 15 minutes. [15]',
     'Roll into thin rounds and cook on a hot tawa, then puff over the flame. [15]'])
rec('Plain paratha', ['breakfast', 'suhoor'], 6, 15, 20, 1, 'k', ['crispy', 'chewy'], ['beige'],
    ['atta 2.5 cup', 'salt 0.5 tsp', 'ghee 4 tbsp'],
    ['Make a soft roti dough and rest. [15]',
     'Roll out, brush with ghee, fold into layers and roll again.', 'Cook on a tawa with a little ghee until golden on both sides. [20]'])
rec('Aloo paratha', ['breakfast', 'suhoor'], 6, 25, 25, 1, 'k', ['crispy', 'soft'], ['beige'],
    ['atta 2.5 cup', 'potato 4 medium; boiled and mashed', 'onion 0.5 medium; finely chopped', 'chilli 2 piece',
     'coriander 1 handful', 'salt 1.25 tsp', 'redchilli 0.5 tsp', 'zeera 0.5 tsp', 'ghee 4 tbsp'],
    ['Make a soft dough and rest. [15]', 'Mix the mashed potato with onion, chilli, coriander and spices.',
     'Stuff dough balls with the filling, roll out and cook on a tawa with ghee until golden. [25]'])
rec('Makai ki roti', ['lunch', 'dinner'], 4, 15, 20, 1, '', ['crispy', 'dry'], ['yellow'],
    ['makaiatta 2 cup', 'salt 0.5 tsp', 'ghee 2 tbsp'],
    ['Knead the maize flour with warm water and salt a little at a time.',
     'Pat each ball into a round between the palms and cook slowly on a tawa, adding ghee. [20]'])
rec('Missi roti', ['breakfast', 'lunch', 'dinner'], 6, 15, 20, 1, '', ['chewy'], ['yellow', 'beige'],
    ['atta 1.5 cup', 'besan 1 cup', 'onion 0.5 medium; finely chopped', 'chilli 2 piece', 'coriander 1 handful',
     'zeera 1 tsp', 'kalonji 0.5 tsp', 'salt 1 tsp', 'ghee 2 tbsp'],
    ['Mix the flours with onion, chilli, coriander, seeds and salt and knead with water. [10]',
     'Roll out and cook on a tawa, brushing with ghee. [20]'])

# ---- breakfast and suhoor (8) ---------------------------------------------------------------------------
rec('Meetha daliya', ['breakfast', 'suhoor'], 3, 5, 25, 1, 'kar', ['soft', 'lumpy'], ['beige'],
    ['daliya 0.5 cup', 'milk 2.5 cup', 'sugar 2 tbsp', 'elaichi 2 pod', '*almonds 8 piece'],
    ['Dry-roast the broken wheat for 3 minutes.', 'Simmer with 1 cup of water until soft, then add the milk and cardamom. [15]',
     'Cook until creamy and sweeten.'])
rec('Namkeen daliya', ['breakfast', 'suhoor'], 3, 10, 25, 1, '', ['soft'], ['beige', 'green'],
    ['daliya 0.75 cup', 'onion 1 medium', 'tomato 1 medium', 'carrot 1 medium', 'peas 0.5 cup', 'salt 1 tsp',
     'haldi 0.25 tsp', 'zeera 1 tsp', 'oil 1.5 tbsp'],
    ['Fry cumin and onion, add tomato and vegetables with spices. [6]',
     'Add the roasted daliya with 2.5 cups of water and cook covered until soft. [18]'])
rec('Oats with milk and dates', ['breakfast', 'suhoor'], 2, 3, 8, 1, 'kar', ['soft', 'lumpy'], ['beige'],
    ['oats 1 cup', 'milk 2 cup', 'dates 4 piece; chopped', '*walnuts 1 tbsp'],
    ['Simmer the oats in milk, stirring, until creamy. [6]', 'Stir in the dates and serve.'])
rec('Besan cheela', ['breakfast', 'suhoor'], 3, 10, 15, 1, '', ['soft'], ['yellow'],
    ['besan 1 cup', 'onion 0.5 medium', 'tomato 0.5 medium', 'chilli 1 piece', 'coriander 0.5 handful',
     'salt 0.75 tsp', 'haldi 0.25 tsp', 'zeera 0.5 tsp', 'oil 1.5 tbsp'],
    ['Whisk the besan with water to a pouring batter and stir in the vegetables and spices.',
     'Spread thinly on a lightly oiled tawa and cook both sides. [15]'])
rec('Moong daal cheela', ['breakfast', 'suhoor'], 3, 130, 15, 1, '', ['soft'], ['green', 'yellow'],
    ['moong 1 cup; soaked 2 hours', 'ginger 1 inch', 'chilli 1 piece', 'salt 0.75 tsp', 'zeera 0.5 tsp',
     'oil 1.5 tbsp', '*coriander 0.5 handful'],
    ['Grind the soaked moong with ginger and chilli to a smooth batter. [120]',
     'Season, spread on a hot tawa and cook both sides with a little oil. [15]'])
rec('Khajoor wala doodh', ['suhoor', 'iftar'], 2, 5, 0, 1, 'kar', ['smooth'], ['beige'],
    ['milk 2 cup', 'dates 6 piece; pitted', '*almonds 6 piece'],
    ['Soak the pitted dates in a little warm milk for 5 minutes. [5]', 'Blend with the rest of the milk until smooth.'])
rec('Dahi with honey and banana', ['breakfast', 'suhoor', 'snack'], 2, 5, 0, 1, 'kar', ['smooth', 'soft'], ['white'],
    ['yogurt 1 cup', 'banana 1 medium; sliced', 'honey 1 tbsp', '*walnuts 1 tbsp'],
    ['Spoon the yogurt into bowls, top with banana and drizzle with honey.'])
rec('Doodh pati chai', ['breakfast', 'snack'], 2, 2, 8, 1, '', ['smooth'], ['brown'],
    ['milk 1.5 cup', 'tea 0.5 cup; strong brew', 'sugar 2 tsp', '*elaichi 2 pod'],
    ['Simmer the milk with the strong tea brew and crushed cardamom until deep tan. [6]', 'Sweeten to taste and strain.'])

# ---- raita, salad, chutney (6) -----------------------------------------------------------------------------
rec('Kachumber salad', ['lunch', 'dinner'], 4, 10, 0, 1, '', ['crunchy', 'wet'], ['red', 'green'],
    ['cucumber 1 medium', 'tomato 2 medium', 'onion 1 medium', 'chilli 1 piece', 'lemon 1 juiced',
     'salt 0.5 tsp', '*coriander 0.5 handful'],
    ['Dice the vegetables small, toss with lemon and salt just before serving.'])
rec('Kheera raita', ['lunch', 'dinner'], 4, 10, 0, 1, 'k', ['smooth', 'crunchy'], ['white', 'green'],
    ['yogurt 2 cup', 'cucumber 1 medium; grated', 'salt 0.5 tsp', 'zeera 0.5 tsp; roasted and crushed'],
    ['Whisk the yogurt, fold in the cucumber and season with salt and roasted cumin.'])
rec('Podina raita', ['lunch', 'dinner'], 4, 5, 0, 1, '', ['smooth'], ['white', 'green'],
    ['yogurt 2 cup', 'mint 1 handful', 'chilli 1 piece', 'salt 0.5 tsp', 'zeera 0.5 tsp'],
    ['Grind the mint with green chilli and whisk into the yogurt with salt and roasted cumin.'])
rec('Lauki raita', ['lunch', 'dinner'], 4, 10, 5, 1, 'ka', ['smooth'], ['white'],
    ['yogurt 2 cup', 'lauki 200 g; grated', 'salt 0.5 tsp', 'zeera 0.5 tsp'],
    ['Steam the grated lauki for 5 minutes and cool. [5]', 'Squeeze lightly and fold into the whisked yogurt with salt and cumin.'])
rec('Podina chutney', ['lunch', 'dinner', 'snack'], 6, 10, 0, 1, '', ['smooth'], ['green'],
    ['mint 2 handful', 'coriander 2 handful', 'chilli 3 piece', 'garlic 2 clove', 'yogurt 0.5 cup',
     'lemon 1 juiced', 'salt 0.75 tsp'],
    ['Blend the herbs, chilli, garlic, lemon and salt, then whisk into the yogurt.'])
rec('Imli chutney', ['snack', 'iftar'], 8, 10, 15, 1, 'r', ['smooth'], ['brown'],
    ['tamarind 100 g', 'shakkar 4 tbsp', 'salt 0.5 tsp', 'redchilli 0.5 tsp', 'zeera 1 tsp; roasted', 'saunf 0.5 tsp'],
    ['Soak the tamarind in hot water and strain the pulp. [10]',
     'Simmer the pulp with shakkar and spices until it coats a spoon. [12]'])

# ---- iftar and snacks (10) ---------------------------------------------------------------------------------
rec('Pakoray', ['iftar', 'snack'], 6, 15, 20, 1, 'r', ['crispy'], ['yellow'],
    ['besan 1.5 cup', 'onion 2 medium; sliced', 'potato 1 medium; thin slices', 'spinach 0.25 bunch',
     'chilli 2 piece', 'coriander 1 handful', 'salt 1.25 tsp', 'redchilli 1 tsp', 'zeera 1 tsp', 'dhaniya 1 tsp',
     'oil 8 tbsp; absorbed share of deep-frying'],
    ['Mix the besan, spices and vegetables with just enough water to bind. [5]',
     'Drop spoonfuls into hot oil and fry until golden and crisp; drain well. [15]'])
rec('Fruit chaat', ['iftar', 'snack'], 6, 15, 0, 2, 'kr', ['soft', 'wet'], ['red', 'yellow'],
    ['apple 2 medium', 'banana 2 medium', 'guava 2 medium', 'kinnow 2 medium', 'pomegranate 0.5 cup',
     'lemon 1 juiced', 'sugar 1 tbsp', 'salt 0.25 tsp', '*pepper 0.25 tsp'],
    ['Cut the fruit into bite-sized pieces.', 'Toss with lemon juice, sugar, a pinch of salt and pepper and chill.'])
rec('Chana chaat', ['iftar', 'snack'], 6, 15, 0, 1, 'r', ['soft', 'crunchy'], ['beige', 'red'],
    ['kabuli 1 cup; soaked and boiled', 'potato 2 medium; boiled and cubed', 'onion 1 medium', 'tomato 1 medium',
     'chilli 1 piece', 'coriander 1 handful', 'tamarind 30 g; pulp', 'salt 1 tsp', 'redchilli 0.5 tsp',
     'zeera 1 tsp; roasted', 'lemon 1 juiced'],
    ['Combine the boiled chickpeas and potatoes with the chopped vegetables.',
     'Dress with tamarind pulp, lemon, salt, chilli and roasted cumin.'])
rec('Aloo chaat', ['iftar', 'snack'], 4, 10, 20, 1, 'r', ['soft'], ['yellow'],
    ['potato 4 medium; boiled and cubed', 'onion 0.5 medium', 'tamarind 20 g; pulp', 'lemon 1 juiced',
     'salt 0.75 tsp', 'redchilli 0.5 tsp', 'zeera 1 tsp; roasted', '*coriander 0.5 handful'],
    ['Boil the potatoes until just tender, cool and cube. [20]', 'Toss with onion, tamarind, lemon and spices.'])
rec('Dahi baray', ['iftar', 'snack'], 6, 130, 25, 1, 'r', ['soft', 'smooth'], ['white'],
    ['mash 1 cup; soaked 2 hours', 'yogurt 2 cup', 'milk 0.5 cup', 'salt 1.25 tsp', 'zeera 1 tsp; roasted',
     'redchilli 0.5 tsp', 'sugar 1 tsp', 'oil 6 tbsp; absorbed share of frying'],
    ['Grind the soaked daal to a light, fluffy batter with a little salt. [120]',
     'Fry spoonfuls in hot oil until golden, then soak in warm water for 10 minutes and squeeze gently. [20]',
     'Whisk yogurt with milk, sugar and salt, pour over the baray and sprinkle with cumin and chilli.'])
rec('Samosa (potato)', ['iftar', 'snack'], 6, 40, 30, 1, 'r', ['crispy', 'soft'], ['beige'],
    ['maida 1.5 cup', 'ghee 2 tbsp; for the dough', 'potato 4 medium; boiled', 'peas 0.5 cup', 'onion 0.5 medium',
     'chilli 2 piece', 'coriander 1 handful', 'salt 1.25 tsp', 'redchilli 0.5 tsp', 'zeera 1 tsp',
     'dhaniya 1 tsp', 'oil 8 tbsp; absorbed share of frying'],
    ['Rub the ghee into the flour with a little salt and knead a stiff dough; rest 20 minutes. [20]',
     'Make the filling of mashed potato, peas, onion, chilli, coriander and spices.',
     'Shape cones from half-rounds of dough, fill, seal and fry on medium heat until golden. [25]'])
rec('Shikanjvi', ['iftar', 'snack'], 4, 5, 0, 1, 'kr', ['smooth'], ['yellow'],
    ['lemon 3 juiced', 'sugar 4 tbsp', 'salt 0.25 tsp', 'water 4 cup', '*mint 0.5 handful'],
    ['Dissolve the sugar and salt in the lemon juice, add chilled water and mint.'])
rec('Banana milkshake', ['suhoor', 'iftar', 'snack'], 2, 5, 0, 1, 'kar', ['smooth'], ['beige'],
    ['banana 2 medium', 'milk 2 cup', 'sugar 1 tsp', '*dates 2 piece'],
    ['Blend the banana and milk until smooth, sweetening lightly or with dates.'])
rec('Namkeen lassi', ['lunch', 'suhoor'], 2, 5, 0, 1, 'r', ['smooth'], ['white'],
    ['yogurt 1.5 cup', 'water 1 cup', 'salt 0.5 tsp', 'zeera 0.5 tsp; roasted', '*mint 0.25 handful'],
    ['Whisk or blend the yogurt with chilled water, salt and roasted cumin until frothy.'])
rec('Meethi lassi', ['suhoor', 'snack'], 2, 5, 0, 1, 'kar', ['smooth'], ['white'],
    ['yogurt 1.5 cup', 'milk 0.5 cup', 'sugar 2 tbsp', '*elaichi 1 pod'],
    ['Blend the yogurt with milk and sugar until frothy and serve chilled.'])

# ---- desserts (5) ------------------------------------------------------------------------------------------
rec('Kheer', ['dinner', 'snack', 'iftar'], 6, 20, 60, 1, 'kar', ['smooth', 'soft'], ['white'],
    ['rice 0.33 cup; soaked and lightly crushed', 'milk 5 cup', 'sugar 0.4 cup', 'elaichi 4 pod',
     '*almonds 10 piece', '*pistachios 1 tbsp'],
    ['Simmer the rice in milk, stirring often, until the grains break down and the milk thickens. [50]',
     'Add sugar and crushed cardamom and cook 10 minutes. Chill and garnish.'])
rec('Sooji halwa', ['breakfast', 'snack'], 6, 5, 20, 1, 'k', ['soft'], ['yellow'],
    ['sooji 1 cup', 'ghee 5 tbsp', 'sugar 0.75 cup', 'elaichi 4 pod', '*almonds 10 piece'],
    ['Make a syrup of the sugar with 2.5 cups of water and cardamom.',
     'Roast the semolina in ghee on low heat until golden and fragrant. [12]',
     'Pour in the syrup carefully and stir until the halwa leaves the sides of the pan. [6]'])
rec('Gajar ka halwa', ['dinner', 'snack'], 8, 20, 90, 2, 'k', ['soft'], ['orange'],
    ['carrot 14 medium; grated', 'milk 4 cup', 'sugar 0.6 cup', 'ghee 4 tbsp', 'elaichi 5 pod', '*almonds 12 piece',
     '*pistachios 1 tbsp'],
    ['Cook the grated carrots in milk until the milk has fully reduced. [60]',
     'Add sugar and cook until dry again, then add ghee and cardamom and fry until glossy. [25]'])
rec('Sheer khurma', ['breakfast', 'snack'], 6, 15, 30, 2, 'k', ['smooth', 'chewy'], ['white'],
    ['seviyan 1 cup', 'milk 5 cup', 'dates 8 piece; slivered', 'sugar 0.33 cup', 'ghee 1 tbsp', 'elaichi 4 pod',
     'almonds 15 piece', 'pistachios 1 tbsp', '*raisins 1 tbsp'],
    ['Fry the vermicelli in ghee until golden and set aside. [4]',
     'Simmer the milk with the dates and cardamom until slightly thickened. [20]',
     'Add the vermicelli, sugar and nuts and simmer 5 minutes.'])
rec('Zarda', ['lunch', 'dinner'], 6, 30, 40, 2, '', ['soft', 'chewy'], ['yellow'],
    ['rice 1.5 cup; soaked 30 min', 'sugar 0.75 cup', 'ghee 4 tbsp', 'elaichi 5 pod', 'laung 3 piece',
     'saffron 1 pinch', 'raisins 2 tbsp', 'almonds 15 piece', '*coconut 2 tbsp'],
    ['Boil the rice until 80 percent done and drain. [10]',
     'Melt the sugar in ghee with cardamom and cloves, add the rice, saffron, raisins and nuts.',
     'Steam covered on very low heat until the syrup is absorbed. [25]'])


# ===================================================================================================
# Sprint 3 additions (S3-16): 100 more recipes, Lahore / Punjab home cooking, halal, catalog ingredients
# only (no soy sauce: mashbooh). kind= names the reference portion family used for portions (see REF).
# ===================================================================================================
A.update({
    'orange': ('Orange (malta)', {'medium': 130}),
    'strawberry': ('Strawberry', {'cup': 150}),
    'jowar': ('Sorghum (jowar)', {'cup': 190}),
    'mozzarella': ('Mozzarella cheese', {}),
    'greentea': ('Green tea, brewed (sabz chai)', {'cup': 237}),
    'apricot': ('Apricot (khubani)', {'medium': 35}),
    'peach': ('Peach (aaru)', {'medium': 150}),
    'figfresh': ('Figs, fresh (anjeer)', {'medium': 50}),
})

# ---- daals and legumes, Sprint 3 (10) ----------------------------------------------------------------
rec('Arhar daal tarka', ['lunch', 'dinner'], 4, 10, 35, 1, 'k', ['soft', 'wet'], ['yellow'],
    ['arhar 1 cup; washed', 'tomato 1 medium; chopped', 'garlic 1 tbsp paste', 'salt 1.25 tsp', 'haldi 0.5 tsp',
     'redchilli 0.5 tsp', 'zeera 1 tsp', 'rai 0.5 tsp', 'ghee 1.5 tbsp', '*coriander 1 handful'],
    ['Boil the daal with turmeric, salt and 4 cups of water until soft, then whisk lightly. [30]',
     'Add the tomato and simmer until it melts in. [5]',
     'Temper cumin, mustard seeds, garlic and chilli powder in ghee and pour over.'], kind='curry')
rec('Moong palak daal', ['lunch', 'dinner'], 4, 10, 30, 1, 'k', ['soft', 'wet'], ['green', 'yellow'],
    ['moong 1 cup; washed', 'spinach 1 bunch; chopped', 'onion 1 medium', 'garlic 1 tbsp paste', 'salt 1.25 tsp',
     'haldi 0.5 tsp', 'zeera 1 tsp', 'oil 2 tbsp'],
    ['Boil the moong with turmeric and salt until soft. [20]',
     'Fry onion and garlic, add the spinach and cook until wilted. [6]',
     'Stir in the daal, simmer 5 minutes and temper with cumin.'], kind='curry')
rec('Kaddu chana daal', ['lunch', 'dinner'], 4, 15, 45, 1, 'k', ['soft', 'wet'], ['orange', 'yellow'],
    ['chanadaal 0.75 cup; soaked 1 hour', 'kaddu 400 g; peeled and cubed', 'onion 1 medium', 'tomato 1 medium',
     'garlic 1 tbsp paste', 'ginger 0.5 tbsp paste'] + SPICE_BASE + ['oil 3 tbsp'],
    ['Boil the daal with turmeric until half done. [20]',
     'Cook a masala of onion, ginger, garlic, tomato and spices, add the pumpkin and cook covered. [10]',
     'Add the daal with its water and simmer until the pumpkin is soft. [15]'], kind='curry')
rec('Khatti masoor daal', ['lunch', 'dinner'], 4, 10, 30, 1, '', ['soft', 'wet'], ['orange'],
    ['masoor 1 cup', 'tamarind 25 g; pulp', 'tomato 1 medium', 'garlic 1 tbsp paste', 'salt 1.25 tsp',
     'redchilli 0.75 tsp', 'haldi 0.5 tsp', 'zeera 1 tsp', 'chilli 2 piece', 'oil 2 tbsp'],
    ['Boil the daal with turmeric, salt and chilli powder until soft. [20]',
     'Stir in the tamarind pulp and tomato and simmer to a pouring consistency. [6]',
     'Temper cumin, garlic and green chillies in oil and pour over.'], kind='curry')
rec('Sookhi moong daal', ['lunch', 'dinner'], 4, 10, 25, 1, '', ['soft', 'dry'], ['yellow'],
    ['moong 1 cup; soaked 30 min', 'onion 1 medium', 'ginger 1 inch; julienned', 'salt 1 tsp', 'haldi 0.25 tsp',
     'redchilli 0.5 tsp', 'zeera 1 tsp', 'oil 2 tbsp', '*lemon 1 juiced', '*coriander 1 handful'],
    ['Simmer the soaked moong with salt and turmeric in just enough water until each grain is soft but separate. [18]',
     'Fry onion and cumin, add the daal and toss on low heat until dry. [5]',
     'Finish with ginger, lemon and coriander.'], kind='dry_curry')
rec('Lobia aloo', ['lunch', 'dinner'], 4, 10, 45, 1, '', ['soft', 'wet'], ['beige', 'red'],
    ['lobia 0.75 cup; soaked overnight', 'potato 2 medium; cubed'] + VEG_BASE + SPICE_BASE + ['oil 3 tbsp'],
    ['Boil the beans until tender. [30]',
     'Cook a masala of onion, ginger, garlic, tomato and spices, add the potato and a cup of water. [10]',
     'Add the beans and simmer until the potato is soft. [10]'], kind='curry')
rec('Aloo chanay', ['breakfast', 'lunch'], 5, 10, 50, 1, 'k', ['soft', 'wet'], ['brown', 'yellow'],
    ['kabuli 1 cup; soaked overnight', 'potato 2 medium; cubed', 'onion 1 medium', 'tomato 2 medium',
     'garlic 1 tbsp paste', 'ginger 1 tbsp paste'] + SPICE_BASE + ['zeera 1 tsp', 'oil 3 tbsp'],
    ['Boil the chickpeas until soft. [35]',
     'Fry onion, ginger, garlic, tomato and spices until thick, add the potatoes. [10]',
     'Add the chickpeas with some cooking water and simmer until the potatoes are soft. [12]'], kind='curry')
rec('Sabut mash daal', ['lunch', 'dinner'], 4, 10, 70, 1, '', ['soft', 'wet'], ['brown'],
    ['mash 1 cup; whole, soaked overnight', 'onion 1 medium', 'tomato 2 medium', 'garlic 1 tbsp paste',
     'ginger 1 tbsp paste', 'salt 1.25 tsp', 'redchilli 1 tsp', 'zeera 1 tsp', 'butter 1 tbsp', 'oil 2 tbsp',
     '*cream 2 tbsp'],
    ['Pressure-cook or boil the soaked daal until very soft. [50]',
     'Fry onion, ginger, garlic and tomato with spices in oil, add the daal and simmer, mashing some. [15]',
     'Finish with butter and a swirl of cream.'], kind='curry')
rec('Daal ke kabab', ['lunch', 'dinner', 'snack'], 4, 120, 20, 1, 'k', ['crispy', 'soft'], ['yellow'],
    ['chanadaal 1 cup; soaked 2 hours', 'onion 0.5 medium; finely chopped', 'chilli 1 piece', 'coriander 1 handful',
     'mint 0.5 handful', 'salt 1 tsp', 'zeera 1 tsp', 'redchilli 0.5 tsp', 'besan 2 tbsp', 'oil 3 tbsp'],
    ['Boil the soaked daal with very little water until just soft and dry. [15]',
     'Grind coarsely with the herbs, onion, chilli, spices and besan, then shape small patties. [10]',
     'Shallow-fry on a tawa until golden on both sides. [10]'], kind='kabab')
rec('Talbina', ['breakfast', 'suhoor'], 3, 5, 25, 1, 'kar', ['smooth', 'soft'], ['beige'],
    ['jauatta 0.33 cup', 'milk 2.5 cup', 'honey 1.5 tbsp', 'dates 4 piece; chopped', '*almonds 6 piece'],
    ['Whisk the barley flour into the cold milk with a cup of water so no lumps form.',
     'Simmer on low heat, stirring, until thick and creamy. [20]',
     'Sweeten with honey and stir in the dates.'], kind='porridge')

# ---- vegetables, Sprint 3 (16) -------------------------------------------------------------------------
rec('Aloo baingan', ['lunch', 'dinner'], 4, 10, 25, 1, '', ['soft'], ['purple', 'yellow'],
    ['baingan 400 g; cubed', 'potato 2 medium; cubed'] + VEG_BASE + SPICE_BASE + ['zeera 1 tsp', 'oil 3 tbsp'],
    ['Fry cumin and onion, then ginger, garlic, tomato and spices. [6]',
     'Add the potato and eggplant, cover and cook on low heat until soft. [18]'], kind='dry_curry')
rec('Aloo bhindi', ['lunch', 'dinner'], 4, 15, 25, 1, 'k', ['soft'], ['green', 'yellow'],
    ['bhindi 400 g; washed, dried and cut', 'potato 2 medium; cut in fingers', 'onion 1 medium; sliced',
     'salt 1.25 tsp', 'redchilli 1 tsp', 'haldi 0.5 tsp', 'dhaniya 1 tsp', 'oil 4 tbsp'],
    ['Fry the potato fingers until half cooked and set aside. [6]',
     'Fry the okra on high heat until no longer sticky. [8]',
     'Add onion, spices and the potato, cover and cook on low heat until tender. [10]'], kind='dry_curry')
rec('Khumbi matar', ['lunch', 'dinner'], 4, 10, 20, 2, '', ['soft', 'wet'], ['brown', 'green'],
    ['mushroom 250 g; sliced', 'peas 1 cup'] + VEG_BASE + SPICE_BASE + ['oil 3 tbsp'],
    ['Cook a masala of onion, ginger, garlic, tomato and spices. [8]',
     'Add the mushrooms and peas with half a cup of water and simmer until tender. [10]'], kind='curry')
rec('Kaddu masala', ['lunch', 'dinner'], 4, 10, 25, 1, 'ka', ['soft'], ['orange'],
    ['kaddu 600 g; peeled and cubed', 'onion 1 medium', 'salt 1 tsp', 'haldi 0.5 tsp', 'redchilli 0.5 tsp',
     'methidana 0.25 tsp', 'saunf 0.5 tsp', 'oil 2 tbsp'],
    ['Temper fenugreek and fennel seeds in oil, add the onion and fry until soft. [5]',
     'Add the pumpkin and spices, cover and cook on low heat until soft, mashing lightly. [18]'], kind='dry_curry')
rec('Aloo gajar', ['lunch', 'dinner'], 4, 10, 20, 1, 'ka', ['soft'], ['orange', 'yellow'],
    ['carrot 4 medium; cubed', 'potato 2 medium; cubed', 'onion 1 medium', 'salt 1 tsp', 'haldi 0.5 tsp',
     'redchilli 0.5 tsp', 'zeera 1 tsp', 'oil 2 tbsp'],
    ['Fry cumin and onion until soft. [4]',
     'Add the vegetables and spices, cover and cook on low heat until tender. [15]'], kind='dry_curry')
rec('Mooli ki bhujia', ['lunch', 'dinner'], 4, 15, 20, 1, '', ['soft'], ['white', 'green'],
    ['mooli 500 g; grated and squeezed', 'onion 1 medium', 'chilli 2 piece', 'salt 1 tsp', 'haldi 0.25 tsp',
     'redchilli 0.5 tsp', 'kalonji 0.5 tsp', 'oil 2 tbsp'],
    ['Fry onion, chilli and nigella seeds in oil. [4]',
     'Add the radish and spices and cook uncovered until dry. [15]'], kind='dry_curry')
rec('Phaliyan aloo', ['lunch', 'dinner'], 4, 15, 20, 1, 'k', ['soft', 'crunchy'], ['green', 'yellow'],
    ['phaliyan 400 g; cut in 2 cm pieces', 'potato 2 medium; cubed', 'onion 1 medium', 'garlic 1 tbsp paste',
     'salt 1 tsp', 'haldi 0.5 tsp', 'redchilli 0.5 tsp', 'zeera 1 tsp', 'oil 2 tbsp'],
    ['Fry cumin, onion and garlic. [4]',
     'Add the beans, potato and spices with a splash of water, cover and cook until tender. [15]'], kind='dry_curry')
rec('Kamal kakri masala', ['lunch', 'dinner'], 4, 15, 30, 2, '', ['crunchy', 'soft'], ['beige', 'red'],
    ['kamal 400 g; peeled and sliced'] + VEG_BASE + SPICE_BASE + ['oil 3 tbsp'],
    ['Boil the lotus root slices until tender. [15]',
     'Cook a masala of onion, ginger, garlic, tomato and spices, add the lotus root and bhuno. [12]'], kind='dry_curry')
rec('Baghare baingan', ['lunch', 'dinner'], 4, 15, 35, 2, '', ['soft', 'wet'], ['purple', 'brown'],
    ['baingan 500 g; small, slit', 'onion 1 medium; sliced', 'peanuts 2 tbsp', 'sesame 1 tbsp', 'coconut 2 tbsp',
     'tamarind 25 g; pulp', 'garlic 1 tbsp paste', 'ginger 1 tbsp paste', 'salt 1.25 tsp', 'redchilli 1 tsp',
     'haldi 0.5 tsp', 'rai 0.5 tsp', 'oil 4 tbsp'],
    ['Dry-roast the peanuts, sesame and coconut and grind with the fried onion to a paste. [8]',
     'Fry the eggplants until lightly browned and set aside. [8]',
     'Temper mustard seeds, add the paste, ginger, garlic, spices and tamarind, then the eggplants, and simmer. [15]'],
    kind='curry')
rec('Dum aloo', ['lunch', 'dinner'], 4, 10, 35, 1, 'k', ['soft', 'wet'], ['red', 'yellow'],
    ['potato 6 medium; small, boiled and peeled', 'yogurt 0.5 cup', 'tomato 1 medium', 'onion 1 medium',
     'garlic 1 tbsp paste', 'ginger 1 tbsp paste', 'salt 1.25 tsp', 'redchilli 1 tsp', 'haldi 0.5 tsp',
     'saunf 0.5 tsp', 'oil 3 tbsp'],
    ['Prick the boiled potatoes and fry until golden. [8]',
     'Cook onion, ginger, garlic, tomato, yogurt and spices to a thick gravy. [12]',
     'Add the potatoes and a little water, cover tightly and cook on dum. [12]'], kind='curry')
rec('Band gobhi gajar', ['lunch', 'dinner'], 4, 10, 15, 1, 'k', ['crunchy', 'soft'], ['green', 'orange'],
    ['cabbage 400 g; shredded', 'carrot 2 medium; julienned', 'capsicum 1 medium; sliced', 'salt 1 tsp',
     'pepper 0.5 tsp', 'zeera 0.5 tsp', 'oil 2 tbsp'],
    ['Stir-fry the vegetables on high heat with cumin, salt and pepper until just tender. [10]'], kind='dry_curry')
rec('Shalgam bharta', ['lunch', 'dinner'], 4, 10, 30, 1, '', ['smooth', 'soft'], ['white'],
    ['shalgam 600 g; peeled and cubed', 'onion 1 medium', 'tomato 1 medium', 'garlic 1 tbsp paste',
     'salt 1 tsp', 'redchilli 0.5 tsp', 'haldi 0.25 tsp', 'oil 2 tbsp'],
    ['Boil the turnips until soft, drain and mash. [20]',
     'Fry onion, garlic, tomato and spices, add the mash and cook until dry. [8]'], kind='dry_curry')
rec('Lauki kofta curry', ['lunch', 'dinner'], 4, 25, 40, 1, '', ['soft', 'wet'], ['green', 'red'],
    ['lauki 500 g; grated and squeezed', 'besan 0.75 cup', 'chilli 1 piece', 'coriander 1 handful',
     'onion 1 medium', 'tomato 2 medium', 'garlic 1 tbsp paste', 'ginger 1 tbsp paste'] + SPICE_BASE
    + ['zeera 1 tsp', 'oil 5 tbsp; part absorbed in frying'],
    ['Mix the lauki with besan, chilli, coriander and a little salt and shape small balls. [10]',
     'Shallow-fry the koftas until golden. [10]',
     'Make a gravy of onion, ginger, garlic, tomato and spices, add water and the koftas and simmer. [15]'],
    kind='curry')
rec('Makai palak', ['lunch', 'dinner'], 4, 10, 20, 2, '', ['soft'], ['green', 'yellow'],
    ['spinach 2 bunch; chopped', 'corn 1 cup', 'onion 1 medium', 'garlic 1 tbsp paste', 'tomato 1 medium',
     'salt 1 tsp', 'redchilli 0.5 tsp', 'cream 2 tbsp', 'oil 2 tbsp'],
    ['Blanch the spinach and blend coarsely. [5]',
     'Fry onion, garlic and tomato with spices, add the spinach and corn and simmer. [10]',
     'Finish with cream.'], kind='curry')
rec('Sohanjna aloo', ['lunch', 'dinner'], 4, 15, 30, 1, '', ['soft', 'wet'], ['green', 'yellow'],
    ['drumstick 300 g; in 7 cm pieces', 'potato 2 medium'] + VEG_BASE + SPICE_BASE + ['oil 3 tbsp'],
    ['Cook a masala of onion, ginger, garlic, tomato and spices. [8]',
     'Add the drumsticks, potatoes and 1.5 cups of water and simmer until tender. [20]'], kind='curry')
rec('Palak saag', ['lunch', 'dinner'], 4, 15, 40, 1, '', ['smooth'], ['green'],
    ['spinach 3 bunch; chopped', 'sarson 250 g; chopped', 'makaiatta 2 tbsp', 'garlic 1 tbsp paste',
     'ginger 0.5 tbsp paste', 'chilli 2 piece', 'onion 1 medium', 'salt 1.25 tsp', 'ghee 2 tbsp'],
    ['Boil the greens with chilli, ginger and salt until very soft. [25]',
     'Blend or churn coarsely and cook with the maize flour until thick. [8]',
     'Fry onion and garlic golden in ghee and pour over.'], kind='curry')

# ---- chicken, Sprint 3 (14) ---------------------------------------------------------------------------
rec('Chicken lauki salan', ['lunch', 'dinner'], 5, 15, 40, 2, 'k', ['soft', 'wet'], ['green', 'brown'],
    CH_BASE + ['lauki 500 g; peeled and cubed', 'onion 1 medium', 'tomato 2 medium', 'garlic 1 tbsp paste',
               'ginger 1 tbsp paste', 'salt 2 tsp', 'redchilli 1 tsp', 'haldi 0.5 tsp', 'dhaniya 2 tsp',
               'oil 4 tbsp', '*coriander 1 handful'],
    ['Fry the onion, add ginger, garlic and chicken and brown. [10]',
     'Add tomato and spices and bhuno until the oil separates. [10]',
     'Add the lauki with a cup of water and simmer until the chicken and lauki are tender. [20]'], kind='curry')
rec('Chicken white karahi', ['lunch', 'dinner'], 5, 15, 35, 3, '', ['soft', 'wet'], ['white'],
    CH_BASE + ['yogurt 1 cup', 'cream 3 tbsp', 'garlic 1.5 tbsp paste', 'ginger 1.5 tbsp paste', 'salt 2 tsp',
               'pepper 1 tsp', 'zeera 1 tsp', 'chilli 4 piece', 'oil 4 tbsp', '*lemon 1 juiced'],
    ['Seal the chicken with ginger and garlic in oil. [8]',
     'Add the whisked yogurt, salt, pepper and cumin and cook until the chicken is tender. [20]',
     'Stir in cream and green chillies and cook until glossy.'], kind='curry')
rec('Achari murgh', ['lunch', 'dinner'], 5, 15, 40, 2, '', ['soft', 'wet'], ['red', 'brown'],
    CH_BASE + ['yogurt 0.5 cup', 'onion 1 medium', 'tomato 2 medium', 'garlic 1 tbsp paste', 'ginger 1 tbsp paste',
               'saunf 1 tsp', 'methidana 0.5 tsp', 'rai 0.5 tsp', 'kalonji 0.5 tsp', 'salt 2 tsp',
               'redchilli 1.5 tsp', 'haldi 0.5 tsp', 'lemon 1 juiced', 'oil 4 tbsp', 'chilli 4 piece; slit'],
    ['Crackle the pickling seeds in oil, add onion and fry golden. [8]',
     'Add chicken, ginger, garlic, tomato, yogurt and spices and bhuno. [15]',
     'Cover and cook until tender, then add the slit chillies and lemon. [15]'], kind='curry')
rec('Chicken handi', ['lunch', 'dinner'], 5, 15, 40, 2, '', ['soft', 'wet'], ['red'],
    ['breast 600 g; cubed', 'onion 2 medium', 'tomato 3 medium', 'yogurt 0.5 cup', 'garlic 1 tbsp paste',
     'ginger 1 tbsp paste', 'salt 1.75 tsp', 'redchilli 1 tsp', 'haldi 0.5 tsp', 'dhaniya 1 tsp',
     'cream 3 tbsp', 'oil 4 tbsp'],
    ['Fry the onion golden, add ginger, garlic and the chicken and seal. [10]',
     'Add tomato, yogurt and spices and cook covered until tender. [20]',
     'Bhuno until the oil separates and finish with cream. [5]'], kind='curry')
rec('Murgh cholay', ['lunch', 'dinner'], 6, 15, 50, 2, '', ['soft', 'wet'], ['brown'],
    CH_BASE + ['kabuli 1 cup; soaked overnight and boiled', 'onion 2 medium', 'tomato 2 medium',
               'garlic 1 tbsp paste', 'ginger 1 tbsp paste'] + SPICE_BASE + ['zeera 1 tsp', 'oil 4 tbsp'],
    ['Fry onion golden, add chicken, ginger and garlic and brown. [10]',
     'Add tomato and spices, bhuno, then add the chickpeas and 2 cups of water. [10]',
     'Simmer until the chicken is tender and the gravy thick. [25]'], kind='curry')
rec('Chicken shorba', ['lunch', 'dinner'], 5, 15, 40, 2, 'k', ['wet', 'soft'], ['yellow', 'red'],
    CH_BASE + ['potato 2 medium; halved', 'onion 1 medium', 'tomato 1 medium', 'garlic 1 tbsp paste',
               'ginger 1 tbsp paste', 'salt 2 tsp', 'redchilli 1 tsp', 'haldi 0.5 tsp', 'dhaniya 1 tsp',
               'oil 3 tbsp', '*coriander 1 handful'],
    ['Make a light masala of onion, ginger, garlic, tomato and spices and brown the chicken in it. [12]',
     'Add the potatoes and 4 cups of water and simmer to a thin, soupy curry. [25]'], kind='curry')
rec('Chicken malai boti', ['lunch', 'dinner'], 4, 130, 20, 3, 'k', ['soft'], ['white'],
    ['breast 600 g; cubed', 'yogurt 0.5 cup', 'cream 3 tbsp', 'garlic 1 tbsp paste', 'ginger 1 tbsp paste',
     'salt 1.25 tsp', 'pepper 0.75 tsp', 'elaichi 0.5 tsp', 'lemon 1 juiced', 'butter 1 tbsp'],
    ['Marinate the chicken in yogurt, cream, ginger, garlic, lemon and spices for 2 hours. [120]',
     'Cook on a hot tawa or under the grill, basting with butter, until lightly charred and cooked through. [15]'],
    kind='kabab')
rec('Chicken reshmi kabab', ['lunch', 'dinner', 'snack'], 4, 30, 20, 2, 'k', ['soft'], ['white'],
    ['breast 500 g; minced', 'onion 0.5 medium; grated and squeezed', 'cream 2 tbsp', 'garlic 1 tbsp paste',
     'ginger 1 tbsp paste', 'salt 1 tsp', 'pepper 0.5 tsp', 'chilli 1 piece; very finely chopped',
     'coriander 0.5 handful', 'oil 2 tbsp'],
    ['Mix the mince with onion, cream, ginger, garlic, herbs and spices and chill 20 minutes. [20]',
     'Shape onto skewers or into long kababs and cook on an oiled tawa, turning, until done. [15]'], kind='kabab')
rec('Chicken corn soup', ['dinner', 'iftar'], 4, 10, 25, 2, 'kar', ['smooth', 'wet'], ['yellow'],
    ['breast 200 g', 'corn 1 cup', 'egg 1 piece', 'cornflour 3 tbsp', 'salt 1 tsp', 'pepper 0.5 tsp',
     '*vinegar 1 tbsp'],
    ['Simmer the chicken in 5 cups of water until cooked, then shred it and return to the stock. [15]',
     'Add the corn and season; thicken with cornflour mixed in cold water. [5]',
     'Drizzle in the beaten egg while stirring.'], kind='soup')
rec('Chicken shashlik', ['lunch', 'dinner'], 4, 30, 20, 2, 'k', ['crunchy', 'soft'], ['red', 'green'],
    ['breast 500 g; cubed', 'capsicum 2 medium; squares', 'onion 2 medium; squares', 'tomato 2 medium; squares',
     'tomatopaste 2 tbsp', 'ketchup 2 tbsp', 'vinegar 1 tbsp', 'garlic 1 tbsp paste', 'salt 1 tsp',
     'pepper 0.5 tsp', 'redchilli 0.5 tsp', 'oil 2 tbsp'],
    ['Marinate the chicken with garlic, vinegar, salt and spices for 20 minutes. [20]',
     'Thread with the vegetables and cook on a hot oiled pan or grill. [12]',
     'Toss in the tomato paste and ketchup sauce for the last minutes.'], kind='dry_curry')
rec('Chicken roti roll', ['lunch', 'snack'], 4, 15, 15, 2, 'k', ['soft', 'chewy'], ['beige'],
    ['roti 4 piece', 'breast 300 g; thin strips', 'yogurt 3 tbsp', 'garlic 1 tbsp paste', 'salt 0.75 tsp',
     'redchilli 0.5 tsp', 'lemon 1 juiced', 'onion 0.5 medium; sliced', 'lettuce 40 g', 'oil 1 tbsp'],
    ['Marinate the chicken strips in yogurt, garlic, lemon and spices for 10 minutes. [10]',
     'Cook on a hot oiled tawa until done. [8]',
     'Fill each roti with chicken, onion and lettuce and roll tightly (lunchbox friendly).'], kind='sandwich')
rec('Lahori steam roast', ['lunch', 'dinner'], 5, 130, 45, 3, '', ['soft'], ['red'],
    CH_BASE + ['yogurt 1 cup', 'garlic 1.5 tbsp paste', 'ginger 1.5 tbsp paste', 'lemon 1 juiced', 'salt 2 tsp',
               'redchilli 1.5 tsp', 'zeera 1 tsp', 'oil 3 tbsp'],
    ['Marinate the chicken in yogurt, lemon, ginger, garlic and spices for 2 hours. [120]',
     'Steam over boiling water until tender. [30]',
     'Brown lightly in a pan with the oil. [10]'], kind='curry')
rec('Chicken kofta curry', ['lunch', 'dinner'], 5, 25, 35, 2, 'k', ['soft', 'wet'], ['red', 'brown'],
    ['breast 500 g; minced', 'onion 2 medium', 'tomato 2 medium', 'garlic 1 tbsp paste', 'ginger 1 tbsp paste',
     'coriander 1 handful', 'chilli 1 piece', 'yogurt 0.5 cup'] + SPICE_BASE + ['oil 4 tbsp'],
    ['Mix the mince with half the ginger and garlic, coriander, chilli and a little salt and shape small balls. [10]',
     'Cook the remaining onion, ginger, garlic, tomato, yogurt and spices to a gravy. [12]',
     'Add water and slide in the koftas; simmer without stirring until firm. [20]'], kind='curry')
rec('Chicken mayo sandwich', ['breakfast', 'lunch', 'snack'], 2, 10, 15, 2, 'k', ['soft'], ['white'],
    ['bread 4 slice', 'breast 150 g', 'mayo 2 tbsp', 'cucumber 0.5 medium; thin slices', 'lettuce 30 g',
     'salt 0.25 tsp', 'pepper 0.25 tsp'],
    ['Boil the chicken with salt until cooked, cool and shred. [15]',
     'Mix with mayonnaise and pepper and fill the bread with cucumber and lettuce.'], kind='sandwich')

# ---- beef and mutton, Sprint 3 (12) ---------------------------------------------------------------------
rec('Karela qeema', ['lunch', 'dinner'], 4, 25, 35, 2, '', ['soft', 'lumpy'], ['green', 'brown'],
    ['mince 400 g', 'karela 400 g; scraped, sliced and salted', 'onion 2 medium', 'tomato 1 medium',
     'garlic 1 tbsp paste', 'ginger 1 tbsp paste'] + SPICE_BASE + ['oil 4 tbsp'],
    ['Rinse and squeeze the salted bitter gourd and fry until browned. [10]',
     'Bhuno the mince with onion, ginger, garlic, tomato and spices until dry. [20]',
     'Fold in the bitter gourd and cook covered 5 minutes.'], kind='dry_curry')
rec('Shimla mirch qeema', ['lunch', 'dinner'], 4, 10, 30, 2, 'k', ['soft', 'lumpy'], ['green', 'brown'],
    ['mince 400 g', 'capsicum 2 medium; diced', 'onion 1 medium', 'tomato 2 medium', 'garlic 1 tbsp paste',
     'ginger 1 tbsp paste'] + SPICE_BASE + ['oil 3 tbsp'],
    ['Bhuno the mince with onion, ginger, garlic, tomato and spices until dry. [20]',
     'Add the capsicum and cook until just tender. [6]'], kind='dry_curry')
rec('Palak qeema', ['lunch', 'dinner'], 4, 10, 30, 2, '', ['soft', 'lumpy'], ['green', 'brown'],
    ['mince 400 g', 'spinach 2 bunch; chopped', 'onion 1 medium', 'tomato 1 medium', 'garlic 1 tbsp paste',
     'ginger 1 tbsp paste'] + SPICE_BASE + ['oil 3 tbsp'],
    ['Bhuno the mince with onion, ginger, garlic, tomato and spices. [15]',
     'Add the spinach and cook until the moisture dries. [12]'], kind='dry_curry')
rec('Seekh kabab', ['lunch', 'dinner', 'snack'], 5, 30, 20, 2, 'k', ['chewy', 'soft'], ['brown'],
    ['mince 500 g', 'onion 1 medium; grated and squeezed', 'garlic 1 tbsp paste', 'ginger 1 tbsp paste',
     'chilli 2 piece; finely chopped', 'coriander 1 handful', 'salt 1.25 tsp', 'redchilli 1 tsp',
     'zeera 1 tsp; roasted', 'dhaniya 1 tsp', 'besan 2 tbsp; roasted', 'oil 1 tbsp'],
    ['Knead the mince with all the ingredients until sticky and chill 20 minutes. [20]',
     'Shape around skewers and grill or cook on an oiled tawa, turning, until done. [15]'], kind='kabab')
rec('Beef kofta curry', ['lunch', 'dinner'], 5, 25, 40, 2, 'k', ['soft', 'wet'], ['red', 'brown'],
    ['mince 500 g', 'onion 2 medium', 'tomato 2 medium', 'garlic 1 tbsp paste', 'ginger 1 tbsp paste',
     'coriander 1 handful', 'yogurt 0.5 cup'] + SPICE_BASE + ['oil 4 tbsp'],
    ['Mix the mince with half the ginger and garlic, coriander and a little salt and shape balls. [10]',
     'Cook onion, remaining ginger and garlic, tomato, yogurt and spices to a gravy. [12]',
     'Add water and the koftas and simmer until cooked through. [25]'], kind='curry')
rec('Arvi gosht', ['lunch', 'dinner'], 5, 20, 75, 3, '', ['soft', 'wet'], ['brown'],
    ['mutton 750 g bone-in; pieces', 'arvi 400 g; peeled and halved', 'onion 2 medium', 'tomato 2 medium',
     'garlic 1 tbsp paste', 'ginger 1 tbsp paste', 'yogurt 0.5 cup'] + SPICE_BASE + ['oil 4 tbsp'],
    ['Brown the meat with onion, ginger and garlic. [12]',
     'Add tomato, yogurt and spices, bhuno, then water, and cook until nearly tender. [45]',
     'Add the taro and simmer until soft. [15]'], kind='curry')
rec('Gobhi gosht', ['lunch', 'dinner'], 5, 20, 70, 3, '', ['soft', 'wet'], ['white', 'brown'],
    ['beef 750 g bone-in; pieces', 'gobhi 500 g; large florets', 'onion 2 medium', 'tomato 2 medium',
     'garlic 1 tbsp paste', 'ginger 1 tbsp paste'] + SPICE_BASE + ['oil 4 tbsp'],
    ['Brown the meat with onion, ginger and garlic, add tomato and spices and bhuno. [15]',
     'Add water and cook until the meat is tender. [45]',
     'Add the cauliflower and cook covered until just soft. [10]'], kind='curry')
rec('Mutton shorba', ['lunch', 'dinner'], 5, 15, 90, 3, 'k', ['wet', 'soft'], ['brown'],
    ['mutton 750 g bone-in; pieces', 'potato 2 medium; halved', 'onion 1 medium', 'tomato 1 medium',
     'garlic 1 tbsp paste', 'ginger 1 tbsp paste', 'salt 2 tsp', 'redchilli 1 tsp', 'haldi 0.5 tsp',
     'dhaniya 1 tsp', 'oil 3 tbsp', '*coriander 1 handful'],
    ['Brown the meat with onion, ginger, garlic, tomato and spices. [15]',
     'Add 6 cups of water and simmer until the meat is tender, adding the potatoes for the last 20 minutes. [70]'],
    kind='curry')
rec('Mutton yakhni', ['dinner', 'iftar'], 4, 10, 90, 3, 'kar', ['wet'], ['beige'],
    ['mutton 500 g bone-in', 'onion 1 medium', 'garlic 4 clove', 'ginger 1 inch', 'salt 1.25 tsp',
     'pepper 0.5 tsp', 'darchini 1 inch', 'laung 3 piece', 'tezpatta 1 piece'],
    ['Simmer everything in 8 cups of water, skimming, until the meat falls off the bone. [90]',
     'Strain, season with pepper and serve hot as a broth.'], kind='soup')
rec('Beef pulao', ['lunch', 'dinner'], 6, 20, 100, 3, '', ['soft'], ['beige'],
    ['beef 750 g bone-in; pieces', 'rice 2.5 cup; soaked 30 min', 'onion 2 medium; sliced', 'garlic 1 tbsp paste',
     'ginger 1 tbsp paste', 'dhaniya 3 tsp', 'saunf 1 tsp', 'elaichi 4 pod', 'laung 6 piece', 'darchini 1 inch',
     'tezpatta 2 piece', 'zeera 1 tsp', 'salt 2.5 tsp', 'oil 5 tbsp'],
    ['Make a yakhni by boiling the beef with ginger, garlic, coriander and fennel in a spice bundle. [60]',
     'Fry the onion golden with whole spices, add the meat and measure the stock to 5 cups. [10]',
     'Add the rice, cook until absorbed and steam on dum. [25]'], kind='rice_main')
rec('Mutton qorma', ['lunch', 'dinner'], 6, 20, 90, 3, '', ['soft', 'wet'], ['brown'],
    ['mutton 1000 g bone-in; pieces', 'onion 3 medium; sliced and fried', 'yogurt 1 cup', 'garlic 1.5 tbsp paste',
     'ginger 1.5 tbsp paste', 'salt 2 tsp', 'redchilli 1.5 tsp', 'dhaniya 2 tsp', 'elaichi 4 pod', 'laung 4 piece',
     'darchini 1 inch', 'oil 6 tbsp', '*almonds 10 piece; ground'],
    ['Brown the meat with whole spices, ginger and garlic. [15]',
     'Add the yogurt, the crushed fried onion and spices and bhuno. [15]',
     'Add water and cook covered on low heat until the meat is tender and the oil rises. [60]'], kind='curry')
rec('Nargisi kofta', ['lunch', 'dinner'], 6, 30, 45, 2, 'k', ['soft', 'wet'], ['brown', 'yellow'],
    ['mince 500 g', 'egg 6 piece; hard-boiled and peeled', 'onion 2 medium', 'tomato 2 medium', 'yogurt 0.5 cup',
     'garlic 1 tbsp paste', 'ginger 1 tbsp paste', 'besan 2 tbsp; roasted'] + SPICE_BASE + ['oil 5 tbsp'],
    ['Mix the mince with half the ginger and garlic, besan and salt; wrap each egg in it. [15]',
     'Shallow-fry the koftas until browned. [10]',
     'Cook a gravy of onion, tomato, yogurt and spices, add water and the koftas and simmer. [20]'], kind='kabab')

# ---- fish and seafood, Sprint 3 (5) ------------------------------------------------------------------
rec('Fish tikka (tawa)', ['lunch', 'dinner'], 4, 40, 15, 3, '', ['soft'], ['orange'],
    ['rohu 600 g; boneless cubes', 'yogurt 3 tbsp', 'lemon 1 juiced', 'garlic 1 tbsp paste', 'ginger 1 tbsp paste',
     'salt 1 tsp', 'redchilli 1 tsp', 'haldi 0.25 tsp', 'zeera 0.5 tsp', 'oil 2 tbsp'],
    ['Marinate the fish in yogurt, lemon, ginger, garlic and spices for 30 minutes. [30]',
     'Cook on a hot oiled tawa, turning once, until opaque. [10]'], kind='kabab')
rec('Baked rohu with lemon', ['lunch', 'dinner'], 4, 15, 25, 2, 'k', ['soft'], ['white', 'yellow'],
    ['rohu 600 g; steaks', 'lemon 2 juiced', 'garlic 1 tbsp paste', 'salt 1 tsp', 'pepper 0.5 tsp',
     'haldi 0.25 tsp', 'olive 1 tbsp', '*coriander 0.5 handful'],
    ['Rub the fish with lemon, garlic, salt, pepper and turmeric. [10]',
     'Bake in a hot oven or covered pan until it flakes. [20]'], kind='kabab')
rec('Prawn pulao', ['lunch', 'dinner'], 5, 20, 35, 3, '', ['soft', 'chewy'], ['beige', 'pink'],
    ['prawns 400 g; cleaned', 'rice 2 cup; soaked 30 min', 'onion 1 medium; sliced', 'tomato 1 medium',
     'garlic 1 tbsp paste', 'ginger 1 tbsp paste', 'salt 2 tsp', 'redchilli 0.75 tsp', 'haldi 0.25 tsp',
     'zeera 1 tsp', 'elaichi 3 pod', 'oil 4 tbsp'],
    ['Fry onion with whole spices, add ginger, garlic, tomato and spices and cook. [8]',
     'Add the prawns for 2 minutes, then 4 cups of water and salt. [4]',
     'Add the rice, cook until absorbed and steam on dum. [22]'], kind='rice_main')
rec('Tuna aloo cutlets', ['lunch', 'dinner', 'snack'], 4, 20, 20, 2, 'k', ['crispy', 'soft'], ['beige'],
    ['tuna 300 g; drained', 'potato 3 medium; boiled and mashed', 'onion 0.5 medium; finely chopped',
     'coriander 0.5 handful', 'egg 1 piece', 'salt 0.75 tsp', 'pepper 0.5 tsp', 'redchilli 0.25 tsp', 'oil 3 tbsp'],
    ['Mix the tuna with potato, onion, coriander and spices and shape cutlets. [10]',
     'Dip in beaten egg and shallow-fry until golden on both sides. [12]'], kind='kabab')
rec('Fish roti roll', ['lunch', 'snack'], 4, 15, 15, 2, 'k', ['soft', 'chewy'], ['beige'],
    ['roti 4 piece', 'rohu 300 g; boneless', 'yogurt 3 tbsp', 'lemon 1 juiced', 'salt 0.75 tsp',
     'redchilli 0.5 tsp', 'onion 0.5 medium; sliced', 'cucumber 0.5 medium; strips', 'oil 1 tbsp'],
    ['Cook the fish on a tawa with salt, chilli and lemon until it flakes. [10]',
     'Spread yogurt on each roti, add the fish, onion and cucumber and roll tightly.'], kind='sandwich')

# ---- eggs, Sprint 3 (5) --------------------------------------------------------------------------------
rec('Anda paratha', ['breakfast', 'suhoor'], 4, 15, 20, 1, 'k', ['crispy', 'soft'], ['beige', 'yellow'],
    ['atta 2 cup', 'egg 4 piece', 'onion 0.5 medium; finely chopped', 'chilli 1 piece', 'salt 1 tsp',
     'ghee 3 tbsp'],
    ['Make a soft dough, rest and roll into rounds. [15]',
     'Cook each paratha half way, slit a pocket and pour in a seasoned beaten egg.',
     'Cook with ghee on both sides until the egg sets. [20]'], kind='paratha')
rec('Aloo anday', ['lunch', 'dinner'], 4, 10, 25, 1, 'k', ['soft', 'wet'], ['yellow', 'red'],
    ['egg 6 piece; hard-boiled', 'potato 3 medium; cubed'] + VEG_BASE + SPICE_BASE + ['oil 3 tbsp'],
    ['Cook a masala of onion, ginger, garlic, tomato and spices. [8]',
     'Add potatoes and 1.5 cups of water and simmer until soft, then add the eggs. [15]'], kind='curry')
rec('Palak anday', ['breakfast', 'lunch'], 3, 10, 15, 1, '', ['soft'], ['green', 'yellow'],
    ['spinach 1 bunch; chopped', 'egg 4 piece', 'onion 1 medium', 'garlic 2 clove', 'salt 0.75 tsp',
     'redchilli 0.25 tsp', 'oil 1.5 tbsp'],
    ['Fry the onion and garlic, add the spinach and cook until wilted. [6]',
     'Make wells, crack in the eggs, cover and cook until set. [6]'], kind='egg')
rec('Timatar anday', ['breakfast', 'suhoor'], 3, 5, 15, 1, 'k', ['soft', 'wet'], ['red', 'yellow'],
    ['egg 4 piece', 'tomato 3 medium; chopped', 'onion 1 medium', 'chilli 1 piece', 'salt 0.75 tsp',
     'redchilli 0.25 tsp', 'zeera 0.5 tsp', 'oil 1.5 tbsp', '*coriander 0.5 handful'],
    ['Cook onion and tomatoes with spices to a soft sauce. [8]',
     'Make wells, crack in the eggs, cover and cook until set. [6]'], kind='egg')
rec('Egg sandwich', ['breakfast', 'lunch', 'snack'], 2, 10, 10, 1, 'k', ['soft'], ['white', 'yellow'],
    ['bread 4 slice', 'egg 3 piece; hard-boiled', 'mayo 1 tbsp', 'cucumber 0.5 medium; thin slices', 'salt 0.25 tsp',
     'pepper 0.25 tsp'],
    ['Mash the eggs with mayonnaise, salt and pepper. [10]', 'Fill the bread with the egg and cucumber.'],
    kind='sandwich')

# ---- rice, Sprint 3 (6) --------------------------------------------------------------------------------
rec('Tahari', ['lunch', 'dinner'], 5, 30, 35, 1, 'k', ['soft'], ['yellow'],
    ['rice 2 cup; soaked 30 min', 'potato 3 medium; cubed', 'peas 0.5 cup', 'onion 1 medium; sliced',
     'tomato 1 medium', 'garlic 1 tbsp paste', 'ginger 1 tbsp paste', 'salt 2 tsp', 'redchilli 0.75 tsp',
     'haldi 0.5 tsp', 'zeera 1 tsp', 'tezpatta 1 piece', 'oil 4 tbsp'],
    ['Fry onion golden, add ginger, garlic, tomato, spices and the potatoes and peas. [10]',
     'Add 4 cups of water and salt, bring to the boil and add the rice. [5]',
     'Cook until absorbed and steam on dum. [20]'], kind='rice_main')
rec('Masoor khichri', ['lunch', 'dinner'], 4, 15, 30, 1, 'ka', ['soft', 'smooth'], ['orange', 'yellow'],
    ['rice 0.75 cup', 'masoor 0.5 cup', 'onion 1 medium; sliced', 'haldi 0.5 tsp', 'salt 1.25 tsp', 'zeera 1 tsp',
     'ghee 1.5 tbsp'],
    ['Wash and soak the rice and lentils together. [15]',
     'Fry onion and cumin in ghee, add the rice, lentils, turmeric, salt and 4 cups of water. [5]',
     'Cook covered until soft and porridge-like. [25]'], kind='rice_main')
rec('Jau moong khichri', ['lunch', 'dinner'], 4, 60, 45, 1, 'k', ['soft'], ['beige', 'yellow'],
    ['jau 0.5 cup; soaked 1 hour', 'moong 0.5 cup', 'carrot 1 medium; diced', 'salt 1.25 tsp', 'haldi 0.25 tsp',
     'zeera 1 tsp', 'ghee 1.5 tbsp'],
    ['Soak the barley. [60]',
     'Cook the barley, moong and carrot with turmeric, salt and 5 cups of water until soft. [40]',
     'Temper cumin in ghee and stir through.'], kind='rice_main')
rec('Desi fried rice', ['lunch', 'dinner'], 4, 15, 15, 1, 'k', ['soft', 'crunchy'], ['white', 'green', 'orange'],
    ['rice 1.5 cup; boiled and cooled', 'egg 2 piece', 'carrot 1 medium; diced', 'peas 0.5 cup',
     'springonion 0.5 bunch', 'capsicum 1 medium; diced', 'garlic 1 tbsp paste', 'salt 1 tsp', 'pepper 0.5 tsp',
     'vinegar 1 tbsp', 'oil 2 tbsp'],
    ['Scramble the eggs in a little oil and set aside. [3]',
     'Stir-fry garlic and the vegetables on high heat. [5]',
     'Add the rice, eggs, salt, pepper and vinegar and toss until hot. [5]'], kind='rice_main')
rec('Vegetable pulao', ['lunch', 'dinner'], 5, 30, 35, 1, 'k', ['soft'], ['white', 'orange', 'green'],
    ['rice 2 cup; soaked 30 min', 'carrot 2 medium; diced', 'peas 0.5 cup', 'potato 1 medium; diced',
     'onion 1 medium; sliced', 'zeera 1 tsp', 'elaichi 3 pod', 'laung 4 piece', 'tezpatta 1 piece', 'salt 2 tsp',
     'oil 3 tbsp'],
    ['Fry the onion with whole spices, add the vegetables and fry 3 minutes. [8]',
     'Add 4 cups of water and salt, boil, add the rice and cook until absorbed; steam on dum. [25]'],
    kind='rice_main')
rec('Brown rice matar pulao', ['lunch', 'dinner'], 4, 30, 45, 1, '', ['chewy', 'soft'], ['brown', 'green'],
    ['brownrice 1.5 cup; soaked 30 min', 'peas 1 cup', 'onion 1 medium; sliced', 'zeera 1 tsp', 'salt 1.5 tsp',
     'tezpatta 1 piece', 'oil 2 tbsp'],
    ['Fry onion and cumin, add peas, 3.5 cups of water and salt and boil. [8]',
     'Add the rice, cover and cook on low heat until absorbed; rest 10 minutes. [35]'], kind='rice_main')

# ---- breads, Sprint 3 (6) --------------------------------------------------------------------------------
rec('Bajra roti', ['lunch', 'dinner'], 4, 15, 20, 1, '', ['dry', 'crispy'], ['brown'],
    ['bajra 240 g; flour', 'salt 0.5 tsp', 'ghee 1 tbsp'],
    ['Knead the millet flour with warm water a little at a time.',
     'Pat into rounds between wet palms and cook slowly on a tawa, brushing with ghee. [20]'], kind='roti')
rec('Jau ki roti', ['lunch', 'dinner'], 6, 15, 15, 1, 'r', ['chewy'], ['beige'],
    ['jauatta 1 cup', 'atta 1.5 cup', 'salt 0.5 tsp'],
    ['Mix the barley and wheat flours with salt and knead with water; rest 15 minutes. [15]',
     'Roll out and cook on a hot tawa like roti. [15]'], kind='roti')
rec('Mooli paratha', ['breakfast', 'suhoor'], 6, 25, 25, 1, '', ['crispy', 'soft'], ['beige'],
    ['atta 2.5 cup', 'mooli 300 g; grated and squeezed', 'chilli 1 piece', 'coriander 0.5 handful',
     'salt 1.25 tsp', 'redchilli 0.25 tsp', 'ghee 4 tbsp'],
    ['Make a soft dough and rest. [15]', 'Season the radish with chilli, coriander and salt just before rolling.',
     'Stuff, roll out and cook with ghee until golden. [25]'], kind='paratha')
rec('Gobhi paratha', ['breakfast', 'suhoor'], 6, 25, 25, 1, 'k', ['crispy', 'soft'], ['beige'],
    ['atta 2.5 cup', 'gobhi 300 g; grated', 'chilli 1 piece', 'coriander 0.5 handful', 'salt 1.25 tsp',
     'zeera 0.5 tsp', 'ghee 4 tbsp'],
    ['Make a soft dough and rest. [15]', 'Mix the grated cauliflower with chilli, coriander, cumin and salt.',
     'Stuff, roll out and cook with ghee until golden. [25]'], kind='paratha')
rec('Daal atta roti', ['lunch', 'dinner'], 6, 15, 15, 1, 'k', ['chewy', 'soft'], ['yellow', 'beige'],
    ['atta 2 cup', 'masoor 0.33 cup; cooked leftover daal', 'salt 0.25 tsp', 'ghee 1 tbsp'],
    ['Knead the flour with yesterday\'s daal and only as much water as needed; rest. [15]',
     'Roll out and cook on a tawa, brushing lightly with ghee. [15]'], kind='roti')
rec('Palak roti', ['lunch', 'dinner'], 6, 15, 15, 1, 'k', ['chewy'], ['green'],
    ['atta 2.5 cup', 'spinach 0.5 bunch; blanched and pureed', 'salt 0.5 tsp', 'zeera 0.5 tsp'],
    ['Knead the flour with the spinach puree, salt and cumin; rest. [15]',
     'Roll out and cook on a hot tawa. [15]'], kind='roti')

# ---- breakfast and suhoor, Sprint 3 (6) ---------------------------------------------------------------------
rec('Masala oats', ['breakfast', 'suhoor'], 2, 5, 12, 1, '', ['soft'], ['beige', 'green'],
    ['oats 1 cup', 'onion 0.5 medium', 'tomato 0.5 medium', 'peas 0.25 cup', 'carrot 0.5 medium', 'salt 0.5 tsp',
     'haldi 0.25 tsp', 'zeera 0.5 tsp', 'oil 1 tbsp'],
    ['Fry cumin, onion and vegetables with turmeric. [4]',
     'Add the oats and 2 cups of water and cook until creamy. [6]'], kind='porridge')
rec('Meethi seviyan', ['breakfast', 'snack'], 4, 5, 15, 1, 'ka', ['soft', 'smooth'], ['beige'],
    ['seviyan 1 cup', 'milk 3 cup', 'sugar 2 tbsp', 'ghee 1 tsp', 'elaichi 2 pod', '*almonds 8 piece'],
    ['Fry the vermicelli golden in ghee. [3]',
     'Add the milk and cardamom and simmer until soft and creamy; sweeten. [10]'], kind='porridge')
rec('Dahi oats with fruit', ['breakfast', 'suhoor', 'snack'], 2, 5, 0, 1, 'kr', ['soft', 'lumpy'], ['white'],
    ['oats 0.5 cup', 'yogurt 1 cup', 'milk 0.5 cup', 'apple 1 medium; diced', 'honey 1 tbsp', '*walnuts 1 tbsp'],
    ['Stir the oats into the yogurt and milk and leave 10 minutes (or overnight in the fridge).',
     'Top with apple and honey.'], kind='porridge')
rec('Cheese omelette', ['breakfast', 'suhoor'], 2, 5, 6, 2, 'k', ['soft'], ['yellow'],
    ['egg 4 piece', 'cheddar 40 g; grated', 'salt 0.25 tsp', 'pepper 0.25 tsp', 'butter 1 tbsp'],
    ['Beat the eggs with salt and pepper.', 'Cook in butter, scatter the cheese over and fold. [5]'], kind='egg')
rec('Apple darchini daliya', ['breakfast', 'suhoor'], 3, 5, 25, 1, 'kar', ['soft', 'lumpy'], ['beige'],
    ['daliya 0.5 cup', 'milk 2 cup', 'apple 1 medium; grated', 'darchini 0.5 tsp', 'honey 1 tbsp'],
    ['Simmer the roasted broken wheat in a cup of water until soft. [15]',
     'Add the milk, apple and cinnamon and cook until creamy; sweeten with honey. [8]'], kind='porridge')
rec('Haldi doodh', ['suhoor', 'snack'], 2, 2, 6, 1, 'ar', ['smooth'], ['yellow'],
    ['milk 2 cup', 'haldi 0.5 tsp', 'pepper 0.1 tsp', 'honey 2 tsp'],
    ['Warm the milk with turmeric and a pinch of pepper, stirring. [5]', 'Sweeten with honey off the heat.'],
    kind='drink')

# ---- raita, salad, chutney, Sprint 3 (6) ---------------------------------------------------------------------
rec('Mix sabzi raita', ['lunch', 'dinner'], 4, 10, 0, 1, '', ['smooth', 'crunchy'], ['white', 'red', 'green'],
    ['yogurt 2 cup', 'cucumber 0.5 medium; finely diced', 'tomato 1 medium; finely diced', 'onion 0.5 medium; finely diced',
     'salt 0.5 tsp', 'zeera 0.5 tsp; roasted'],
    ['Whisk the yogurt and fold in the vegetables, salt and roasted cumin.'], kind='raita')
rec('Phal raita', ['lunch', 'dinner', 'snack'], 4, 10, 0, 1, 'ka', ['smooth', 'soft'], ['white', 'red'],
    ['yogurt 2 cup', 'banana 1 medium; sliced', 'pomegranate 0.25 cup', 'apple 0.5 medium; diced', 'sugar 1 tsp',
     'salt 0.25 tsp'],
    ['Whisk the yogurt with sugar and salt and fold in the fruit just before serving.'], kind='raita')
rec('Chana salad', ['lunch', 'dinner', 'snack'], 4, 15, 0, 1, '', ['soft', 'crunchy'], ['beige', 'red', 'green'],
    ['kabuli 0.75 cup; soaked and boiled', 'cucumber 1 medium', 'tomato 1 medium', 'onion 0.5 medium',
     'lemon 1 juiced', 'olive 1 tbsp', 'salt 0.5 tsp', 'zeera 0.5 tsp; roasted', '*coriander 0.5 handful'],
    ['Dice the vegetables and toss with the chickpeas, lemon, oil, salt and cumin.'], kind='salad')
rec('Hara salad', ['lunch', 'dinner'], 4, 10, 0, 1, 'k', ['crunchy'], ['green'],
    ['lettuce 150 g', 'cucumber 1 medium', 'capsicum 0.5 medium', 'lemon 1 juiced', 'olive 1 tbsp', 'salt 0.25 tsp'],
    ['Tear the lettuce, slice the cucumber and capsicum and dress with lemon, oil and salt.'], kind='salad')
rec('Aloo bukhara chutney', ['lunch', 'dinner', 'snack'], 8, 10, 25, 1, '', ['smooth'], ['red', 'brown'],
    ['plum 15 piece; dried', 'shakkar 3 tbsp', 'salt 0.5 tsp', 'redchilli 0.5 tsp', 'saunf 0.5 tsp'],
    ['Soak the dried plums, then simmer with shakkar, salt and spices until jammy. [20]',
     'Mash lightly and cool.'], kind='chutney')
rec('Tamatar chutney', ['lunch', 'dinner', 'snack'], 6, 5, 20, 1, '', ['smooth'], ['red'],
    ['tomato 4 medium; chopped', 'garlic 3 clove', 'redchilli 0.5 tsp', 'salt 0.5 tsp', 'sugar 1 tsp',
     'kalonji 0.25 tsp', 'oil 1 tbsp'],
    ['Temper nigella seeds and garlic in oil, add the tomatoes and spices and cook down until thick. [18]'],
    kind='chutney')

# ---- iftar and snacks, Sprint 3 (9) ---------------------------------------------------------------------
rec('Mausami phal plate', ['snack', 'iftar', 'breakfast'], 4, 10, 0, 1, 'kar', ['soft', 'crunchy'], ['red', 'yellow'],
    ['apple 1 medium', 'banana 2 medium', 'guava 1 medium', 'kinnow 2 medium'],
    ['Wash and cut the fruit into sticks or segments and serve on a plate.'], kind='fruit')
rec('Shakarkandi chaat', ['snack', 'iftar'], 4, 10, 25, 1, 'kr', ['soft'], ['orange'],
    ['shakarkandi 3 medium', 'lemon 1 juiced', 'salt 0.5 tsp', 'zeera 0.5 tsp; roasted', 'redchilli 0.25 tsp'],
    ['Boil or roast the sweet potatoes until tender, peel and cube. [25]',
     'Toss with lemon, salt, roasted cumin and chilli.'], kind='chaat')
rec('Makai chaat', ['snack', 'iftar'], 4, 10, 10, 1, 'kr', ['crunchy', 'soft'], ['yellow'],
    ['corn 2 cup', 'onion 0.5 medium', 'tomato 1 medium', 'lemon 1 juiced', 'butter 1 tbsp', 'salt 0.5 tsp',
     'redchilli 0.25 tsp'],
    ['Boil the corn kernels and toss in butter. [8]',
     'Mix with onion, tomato, lemon, salt and chilli.'], kind='chaat')
rec('Qeema samosa', ['iftar', 'snack'], 6, 40, 30, 2, 'r', ['crispy', 'soft'], ['beige'],
    ['maida 1.5 cup', 'mince 250 g', 'onion 1 medium', 'peas 0.25 cup', 'chilli 2 piece', 'coriander 1 handful',
     'salt 1.25 tsp', 'redchilli 0.5 tsp', 'zeera 1 tsp', 'ghee 2 tbsp; for the dough',
     'oil 8 tbsp; absorbed share of frying'],
    ['Rub the ghee into the flour with a little salt and knead a stiff dough; rest. [20]',
     'Cook the mince dry with onion, peas, chilli, coriander and spices. [15]',
     'Shape cones, fill, seal and fry on medium heat until golden. [25]'], kind='snack_piece')
rec('Aloo tikki', ['iftar', 'snack'], 4, 20, 20, 1, 'kr', ['crispy', 'soft'], ['yellow'],
    ['potato 4 medium; boiled and mashed', 'peas 0.25 cup', 'coriander 0.5 handful', 'chilli 1 piece',
     'cornflour 2 tbsp', 'salt 1 tsp', 'zeera 0.5 tsp', 'redchilli 0.25 tsp', 'oil 3 tbsp'],
    ['Mix the potato with peas, herbs, spices and cornflour and shape patties. [10]',
     'Shallow-fry until golden on both sides. [12]'], kind='snack_piece')
rec('Khajoor ke laddu', ['snack', 'iftar', 'suhoor'], 8, 15, 5, 2, 'kar', ['chewy'], ['brown'],
    ['dates 20 piece; pitted', 'oats 0.5 cup', 'almonds 15 piece', 'walnuts 2 tbsp', 'coconut 2 tbsp'],
    ['Lightly toast the oats and nuts. [5]',
     'Blend with the dates, roll into small balls and coat with coconut. Children can roll them.'],
    kind='sweet_piece')
rec('Khajoor aur badam', ['iftar', 'suhoor', 'snack'], 4, 2, 0, 2, 'ar', ['chewy', 'crunchy'], ['brown'],
    ['dates 12 piece', 'almonds 24 piece'],
    ['Serve dates with a few almonds to open the fast, in the Sunnah way.'], kind='sweet_piece')
rec('Aam lassi', ['suhoor', 'snack'], 2, 5, 0, 1, 'kar', ['smooth'], ['yellow'],
    ['mango 1 cup', 'yogurt 1 cup', 'milk 0.5 cup', 'sugar 1 tsp'],
    ['Blend the mango with yogurt, milk and sugar until smooth; serve chilled.'], kind='drink')
rec('Badam doodh', ['suhoor', 'snack'], 2, 10, 8, 2, 'kar', ['smooth'], ['white'],
    ['milk 2 cup', 'almonds 16 piece; soaked and peeled', 'sugar 2 tsp', 'elaichi 1 pod', '*saffron 1 pinch'],
    ['Grind the almonds with a little milk to a paste. [5]',
     'Simmer with the rest of the milk, sugar and cardamom for a few minutes; serve warm or chilled. [6]'],
    kind='drink')
# ---- desserts, Sprint 3 (4) ------------------------------------------------------------------------------
rec('Firni', ['dinner', 'snack', 'iftar'], 6, 15, 30, 1, 'kar', ['smooth'], ['white'],
    ['rice 0.33 cup; soaked and ground to a paste', 'milk 4 cup', 'sugar 0.33 cup', 'elaichi 4 pod',
     '*pistachios 1 tbsp'],
    ['Whisk the rice paste into cold milk.', 'Cook on low heat, stirring, until thick and smooth. [25]',
     'Sweeten, flavour with cardamom and set in small bowls.'], kind='dessert')
rec('Lauki ka halwa', ['dinner', 'snack'], 6, 15, 60, 1, 'k', ['soft'], ['green'],
    ['lauki 750 g; grated', 'milk 3 cup', 'sugar 0.5 cup', 'ghee 3 tbsp', 'elaichi 4 pod', '*almonds 10 piece'],
    ['Cook the grated lauki in milk until the milk has reduced. [40]',
     'Add sugar and cook until dry, then fry in ghee with cardamom. [15]'], kind='dessert')
rec('Gur wale chawal', ['lunch', 'dinner'], 6, 30, 35, 1, 'k', ['soft', 'chewy'], ['brown'],
    ['rice 1.5 cup; soaked 30 min', 'shakkar 8 tbsp', 'ghee 3 tbsp', 'saunf 1 tsp', 'elaichi 3 pod',
     '*coconut 2 tbsp', '*almonds 10 piece'],
    ['Boil the rice until 80 percent done and drain. [10]',
     'Melt the shakkar with a little water, fennel and cardamom, add ghee and the rice. [5]',
     'Steam covered on very low heat until the syrup is absorbed. [20]'], kind='dessert')
rec('Fruit custard', ['dinner', 'snack', 'iftar'], 6, 10, 15, 2, 'kar', ['smooth', 'soft'], ['yellow'],
    ['milk 4 cup', 'cornflour 3 tbsp', 'sugar 0.33 cup', 'egg 1 piece', 'banana 2 medium', 'apple 1 medium',
     'grapes 0.5 cup'],
    ['Whisk the cornflour, sugar and egg into a cup of the cold milk.',
     'Heat the rest of the milk, stir in the mixture and cook until thick. [10]',
     'Cool, then fold in the chopped fruit.'], kind='dessert')
# ---- soups, Sprint 3 (1) ---------------------------------------------------------------------------------
rec('Masoor shorba', ['dinner', 'iftar'], 4, 10, 30, 1, 'kar', ['smooth', 'wet'], ['orange'],
    ['masoor 0.75 cup', 'carrot 1 medium', 'tomato 1 medium', 'onion 0.5 medium', 'garlic 2 clove', 'salt 1 tsp',
     'zeera 0.5 tsp', 'pepper 0.25 tsp', 'lemon 1 juiced', 'olive 1 tbsp'],
    ['Simmer the lentils and vegetables in 5 cups of water until soft. [25]',
     'Blend smooth, season and finish with lemon and olive oil.'], kind='soup')


# ---------------------------------------------------------------------------------------------------
def parse_ingredients():
    """name -> {nutrient: Decimal | None} from the 040 seed."""
    rows = {}
    pat = re.compile(r"^  \('((?:[^']|'')*)', ")
    with open(ING_SQL, encoding='utf-8') as fh:
        for line in fh:
            m = pat.match(line)
            if not m:
                continue
            body = line.strip().rstrip(',')
            assert body.startswith('(') and body.endswith(')'), line
            fields = split_sql_tuple(body[1:-1])
            name = fields[0].strip("'").replace("''", "'")
            # quantize to the ingredients column scale (kcal numeric(7,1), the rest numeric(_,2)) exactly as
            # Postgres stores the 040 literals, so the generator matches the trigger to the last digit
            rows[name] = {k: (None if fields[i] == 'null' else
                              Decimal(fields[i]).quantize(Decimal('0.1') if k == 'kcal' else Decimal('0.01'),
                                                          rounding=ROUND_HALF_UP))
                          for k, i, _ in NUTRIENTS}
    if len(rows) != 150:
        sys.exit(f'expected 150 ingredients in {ING_SQL}, found {len(rows)}')
    return rows


def split_sql_tuple(s):
    out, cur, q = [], '', False
    i = 0
    while i < len(s):
        c = s[i]
        if c == "'":
            if q and i + 1 < len(s) and s[i + 1] == "'":
                cur += "''"
                i += 2
                continue
            q = not q
            cur += c
        elif c == ',' and not q:
            out.append(cur.strip())
            cur = ''
        else:
            cur += c
        i += 1
    out.append(cur.strip())
    return out


def parse_line(spec):
    optional = spec.startswith('*')
    spec = spec.lstrip('*')
    note = None
    if ';' in spec:
        spec, note = (p.strip() for p in spec.split(';', 1))
    parts = spec.split()
    alias, qty, unit = parts[0], Decimal(parts[1]), ' '.join(parts[2:])
    if alias not in A:
        sys.exit(f'unknown ingredient alias {alias!r}')
    name, units = A[alias]
    if unit == 'g':
        grams = qty
    elif unit in units:
        grams = qty * Decimal(str(units[unit]))
    else:
        sys.exit(f'no gram weight for {qty} {unit!r} of {alias}')
    grams = grams.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
    return dict(name=name, qty=qty, unit=unit, grams=grams, optional=optional, note=note)


def rnd(x, digits):
    return x.quantize(Decimal(1).scaleb(-digits), rounding=ROUND_HALF_UP)


def nutrition(ings, servings, catalog):
    out = {}
    live = [i for i in ings if not i['optional']]
    for key, _, digits in NUTRIENTS:
        vals = [catalog[i['name']][key] * i['grams'] / 100 for i in live if catalog[i['name']][key] is not None]
        if vals:
            out[key] = rnd(sum(vals) / servings, digits)
    out['grams'] = rnd(sum(i['grams'] for i in live) / servings, 0)
    return out


def q(s):
    return "'" + s.replace("'", "''") + "'"


def arr(xs, typ='text'):
    return "'{" + ','.join(xs) + "}'::" + typ + '[]'


def jnum(d):
    # plain notation at the scale round() produces, so the text matches what the trigger stores
    return format(d, 'f')


def build():
    catalog = parse_ingredients()
    titles = set()
    recipes = []
    for r in R:
        if r['title'].lower() in titles:
            sys.exit(f'duplicate title {r["title"]}')
        titles.add(r['title'].lower())
        ings = [parse_line(s) for s in r['ings']]
        for i in ings:
            if i['name'] not in catalog:
                sys.exit(f'{r["title"]}: ingredient {i["name"]!r} is not in 040')
        names = [i['name'] for i in ings]
        if len(names) != len(set(names)) and not all(names.count(n) == 1 or n == 'Ginger (adrak)' for n in names):
            sys.exit(f'{r["title"]}: duplicate ingredient')
        steps = []
        for n, s in enumerate(r['steps'], 1):
            m = re.search(r'\s*\[(\d+)\]$', s)
            step = {'n': n, 'text_i18n': {'en': s[:m.start()] if m else s}}
            if m:
                step['timer_min'] = int(m.group(1))
            steps.append(step)
        r = dict(r, ings=ings, steps=steps, nut=nutrition(ings, Decimal(r['servings']), catalog))
        recipes.append(r)
    if len(recipes) != 200:
        sys.exit(f'expected 200 recipes, have {len(recipes)}')
    return recipes, catalog


HEADER = """-- supabase/seed/catalog/090_recipes.sql
-- GENERATED by tooling/scripts/gen-recipe-seed.py; edit the recipe list there and re-run.
-- 200 curated Pakistani (Lahore / Punjab home-style) recipes for the global catalog (100 in S2-16, 100 more
-- in S3-16). Halal: no haram or mashbooh ingredient; meat, poultry and fish depend on a zabiha source.
-- Every ingredient is one of the 150 Sprint 1 ingredients (040). per_serving_nutrition is computed by
-- the generator with the same formula as public.recompute_recipe_nutrition() and is recomputed by the
-- recipe_ingredients trigger on load. Grams are raw edible weights (bone-in meat converted with a flat
-- yield: chicken 0.70, mutton and beef 0.75); cooking water is not counted.
-- Idempotent: recipes key on lower(title) for global rows (recipes_catalog_title_key); ingredient rows
-- are only inserted for a recipe that has none yet.
--
-- REVIEW REQUIRED: every recipe loads as review_status 'in_review', so 05 16.3.3 RLS keeps it hidden from
-- users until a registered dietitian sets it 'verified' after checking quantities, servings, nutrition
-- and the kid_friendly / autism_friendly / ramadan_suitable flags. title_i18n carries English only:
-- Urdu titles need a native speaker (never machine-invented). Meat, poultry and fish recipes depend on
-- a zabiha/halal source (ingredients.halal_status 'depends_on_source').
"""


def render(recipes):
    out = [HEADER]
    out.append('insert into public.recipes (title, title_i18n, cuisine, region_tags, meal_types, servings, prep_min,\n'
               '  cook_min, steps, texture_profile, colors, kid_friendly, autism_friendly, ramadan_suitable, cost_tier,\n'
               '  per_serving_nutrition, source, review_status)\nvalues')
    vals = []
    for r in recipes:
        nut = '{' + ', '.join(f'"{k}": {jnum(v)}' for k, v in r['nut'].items()) + '}'
        vals.append('  (' + ', '.join([
            q(r['title']), q(json.dumps({'en': r['title']}, ensure_ascii=False)) + '::jsonb', q('pakistani'),
            arr(r['region']), arr(r['meals'], 'public.meal_type'), str(r['servings']), str(r['prep']),
            str(r['cook']), q(json.dumps(r['steps'], ensure_ascii=False)) + '::jsonb',
            arr(r['textures'], 'public.texture'), arr(r['colors']),
            str('k' in r['flags']).lower(), str('a' in r['flags']).lower(), str('r' in r['flags']).lower(),
            str(r['cost']), q(nut) + '::jsonb', q('curated'), q('in_review') + '::public.verification_status',
        ]) + ')')
    out.append(',\n'.join(vals))
    out.append("on conflict ((lower(title))) where household_id is null do nothing;\n")

    out.append('insert into public.recipe_ingredients (recipe_id, ingredient_id, quantity, unit, grams, optional,\n'
               '  prep_note, sort_order)\n'
               'select r.id, i.id, v.quantity, v.unit, v.grams, v.optional, v.prep_note, v.sort_order\n'
               'from (values')
    rows = []
    for r in recipes:
        for n, i in enumerate(r['ings'], 1):
            rows.append('  (' + ', '.join([
                q(r['title']), q(i['name']), format(i['qty'].normalize(), 'f'), q(i['unit']),
                format(i['grams'], 'f'), str(i['optional']).lower(), q(i['note']) if i['note'] else 'null', str(n),
            ]) + ')')
    out.append(',\n'.join(rows))
    out.append(') v(title, ingredient, quantity, unit, grams, optional, prep_note, sort_order)\n'
               'join public.recipes r on lower(r.title) = lower(v.title) and r.household_id is null\n'
               'join public.ingredients i on lower(i.name) = lower(v.ingredient)\n'
               'where not exists (select 1 from public.recipe_ingredients x where x.recipe_id = r.id);\n')

    out.append('-- guard: every catalog recipe above has exactly its ingredient rows (a renamed ingredient would\n'
               '-- otherwise drop silently out of the join)\n'
               'do $$\ndeclare v_bad text;\nbegin\n'
               '  select string_agg(v.title, \', \') into v_bad\n  from (values')
    out.append(',\n'.join(f'    ({q(r["title"])}, {len(r["ings"])})' for r in recipes))
    out.append('  ) v(title, n)\n'
               '  join public.recipes r on lower(r.title) = lower(v.title) and r.household_id is null\n'
               '  where (select count(*) from public.recipe_ingredients x where x.recipe_id = r.id) <> v.n;\n'
               '  if v_bad is not null then\n'
               '    raise exception \'090_recipes: ingredient rows missing for %\', v_bad;\n'
               '  end if;\nend $$;\n')
    return '\n'.join(out)


# ===================================================================================================
# Sprint 3: reference portions, meals, meal alternatives (092_meals.sql) and Punjab seasonal produce
# (095_seasonal_produce.sql).
# ===================================================================================================

# Portion family of every Sprint 2 recipe (Sprint 3 recipes pass kind= to rec()).
KIND = {
    'Masoor daal': 'curry', 'Chana daal tarka': 'curry', 'Daal mash (Lahori dry)': 'dry_curry', 'Moong daal': 'curry',
    'Mixed daal': 'curry', 'Lauki chana daal': 'curry', 'Palak daal': 'curry', 'Sabut masoor': 'curry',
    'Lobia masala': 'curry', 'Rajma masala': 'curry', 'Lahori chanay': 'curry', 'Daal gosht': 'curry',
    'Haleem': 'curry',
    'Aloo gobhi': 'dry_curry', 'Aloo matar': 'curry', 'Aloo palak': 'dry_curry', 'Bhindi masala': 'dry_curry',
    'Karela pyaz': 'dry_curry', 'Lauki ki sabzi': 'curry', 'Tori ki sabzi': 'curry', 'Khatta meetha kaddu': 'dry_curry',
    'Baingan bharta': 'dry_curry', 'Shalgam ki sabzi': 'dry_curry', 'Arvi masala': 'dry_curry',
    'Sarson ka saag': 'curry', 'Mix sabzi': 'dry_curry', 'Shimla mirch aloo': 'dry_curry', 'Gajar matar': 'dry_curry',
    'Band gobhi matar': 'dry_curry', 'Aloo ka salan': 'curry',
    'Chicken karahi': 'curry', 'Chicken salan': 'curry', 'Aloo murgh': 'curry', 'Chicken qorma': 'curry',
    'Chicken biryani': 'rice_main', 'Chicken yakhni pulao': 'rice_main', 'Chicken tikka (tawa)': 'kabab',
    'Chicken jalfrezi': 'dry_curry', 'Palak murgh': 'curry', 'Chicken kaleji masala': 'dry_curry',
    'Chicken vegetable soup': 'soup', 'Chapli kabab': 'kabab',
    'Qeema matar': 'dry_curry', 'Aloo qeema': 'dry_curry', 'Shami kabab': 'kabab', 'Beef nihari': 'curry',
    'Aloo gosht': 'curry', 'Mutton karahi': 'curry', 'Bhindi gosht': 'curry', 'Shalgam gosht': 'curry',
    'Lauki gosht': 'curry', 'Mutton pulao': 'rice_main', 'Beef kaleji': 'dry_curry',
    'Lahori fried fish': 'kabab', 'Fish salan': 'curry', 'Tawa surmai': 'kabab', 'Prawn karahi': 'curry',
    'Anday ka khagina': 'egg', 'Masala omelette': 'egg', 'Anda curry': 'curry', 'Boiled eggs': 'egg',
    'Plain boiled basmati': 'rice_side', 'Zeera rice': 'rice_side', 'Matar pulao': 'rice_main',
    'Chana pulao': 'rice_main', 'Moong daal khichri': 'rice_main',
    'Roti (chapati)': 'roti', 'Plain paratha': 'paratha', 'Aloo paratha': 'paratha', 'Makai ki roti': 'roti',
    'Missi roti': 'roti',
    'Meetha daliya': 'porridge', 'Namkeen daliya': 'porridge', 'Oats with milk and dates': 'porridge',
    'Besan cheela': 'cheela', 'Moong daal cheela': 'cheela', 'Khajoor wala doodh': 'drink',
    'Dahi with honey and banana': 'porridge', 'Doodh pati chai': 'drink_adult',
    'Kachumber salad': 'salad', 'Kheera raita': 'raita', 'Podina raita': 'raita', 'Lauki raita': 'raita',
    'Podina chutney': 'chutney', 'Imli chutney': 'chutney',
    'Pakoray': 'snack_plate', 'Fruit chaat': 'chaat', 'Chana chaat': 'chaat', 'Aloo chaat': 'chaat',
    'Dahi baray': 'chaat', 'Samosa (potato)': 'snack_piece', 'Shikanjvi': 'drink', 'Banana milkshake': 'drink',
    'Namkeen lassi': 'drink', 'Meethi lassi': 'drink',
    'Kheer': 'dessert', 'Sooji halwa': 'dessert', 'Gajar ka halwa': 'dessert', 'Sheer khurma': 'dessert',
    'Zarda': 'dessert',
}

# Reference household serving per portion family (05 7.9, 14 sections 6.1 and 6.2).
# SOURCE: serving definitions of the Pakistan Dietary Guidelines for Better Nutrition (Ministry of
# Planning, Development and Reform with FAO, 2018: 1 chapati or 1/2 cup cooked rice = 1 cereal serving,
# 1/2 cup cooked daal = 1 pulse serving, 60 to 90 g cooked meat = 1 meat serving, 1 cup milk or yogurt,
# 1 medium fruit) expressed in the 14 section 6.2 household measures (katori 200 ml, roti about 47 g
# cooked, glass 220 ml, fist about 80 g). Child (3 to 12 y) reference = 1/2 adult, toddler (1 to 3 y) =
# 1/3 adult (14 section 6.1: a quarter to a third), rounded UP to the next household fraction, so a
# child's reference is never below the arithmetic share. Older adults get 3/4 of the adult cereal
# (rice, roti, paratha) and the full adult protein and vegetable serving (14 section 6.1). Teens get
# the adult reference. Infants get no portions (14 section 6.1).
# kind: (unit, plural, cooked grams per unit, adult units, older-adult share of cereals, child share,
#        toddler share, component role)
REF = {
    'curry':       ('katori', 'katori', 200, 1, 1, Fraction(1, 2), Fraction(1, 3), 'main'),
    'dry_curry':   ('katori', 'katori', 150, 1, 1, Fraction(1, 2), Fraction(1, 3), 'main'),
    'kabab':       ('piece', 'pieces', 60, 2, 1, Fraction(1, 2), Fraction(1, 3), 'main'),
    'egg':         ('egg', 'eggs', 50, 2, 1, Fraction(1, 2), Fraction(1, 2), 'main'),
    'soup':        ('bowl', 'bowls', 250, 1, 1, Fraction(1, 2), Fraction(1, 3), 'main'),
    'sandwich':    ('roll', 'rolls', 150, 1, 1, Fraction(1, 2), Fraction(1, 3), 'main'),
    'porridge':    ('katori', 'katori', 200, 1, 1, Fraction(3, 4), Fraction(1, 2), 'main'),
    'rice_main':   ('cup', 'cups', 180, Fraction(3, 2), Fraction(3, 4), Fraction(1, 2), Fraction(1, 3), 'main'),
    'rice_side':   ('cup', 'cups', 160, 1, Fraction(3, 4), Fraction(1, 2), Fraction(1, 3), 'rice'),
    'roti':        ('roti', 'roti', 47, 2, Fraction(3, 4), Fraction(1, 2), Fraction(1, 3), 'bread'),
    'paratha':     ('paratha', 'parathas', 90, 1, Fraction(3, 4), Fraction(1, 2), Fraction(1, 3), 'bread'),
    'cheela':      ('cheela', 'cheelay', 70, 2, 1, Fraction(1, 2), Fraction(1, 3), 'main'),
    'raita':       ('katori', 'katori', 200, Fraction(1, 2), 1, Fraction(1, 2), Fraction(1, 3), 'side'),
    'salad':       ('fist', 'fists', 80, 1, 1, Fraction(1, 2), Fraction(1, 3), 'salad'),
    'chutney':     ('tbsp', 'tbsp', 15, 2, 1, Fraction(1, 2), Fraction(1, 3), 'dip'),
    'fruit':       ('cup', 'cups', 150, 1, 1, Fraction(3, 4), Fraction(1, 2), 'fruit'),
    'chaat':       ('katori', 'katori', 150, 1, 1, Fraction(1, 2), Fraction(1, 3), 'main'),
    'snack_piece': ('piece', 'pieces', 60, 2, 1, Fraction(1, 2), Fraction(1, 3), 'main'),
    'snack_plate': ('small plate', 'small plates', 100, 1, 1, Fraction(1, 2), Fraction(1, 3), 'main'),
    'sweet_piece': ('piece', 'pieces', 20, 2, 1, Fraction(1, 2), Fraction(1, 2), 'side'),
    'drink':       ('glass', 'glasses', 220, 1, 1, Fraction(3, 4), Fraction(1, 2), 'drink'),
    'drink_adult': ('cup', 'cups', 150, 1, 1, None, None, 'drink'),   # tea: no child or toddler rows
    'dessert':     ('small katori', 'small katori', 100, 1, 1, Fraction(1, 2), Fraction(1, 3), 'side'),
}
CEREAL = {'rice_main', 'rice_side', 'roti', 'paratha'}
STAGES = ['adult', 'older_adult', 'teen', 'child', 'toddler']
# meal-level tiers per life stage (14 section 6.3): multiplier of the stage reference; 'extra' is the
# second helping offered on top of 'start' (always available, never a cap).
TIERS = {'adult': [('standard', 1)], 'older_adult': [('standard', 1)],
         'teen': [('ideal', 1), ('extra', Fraction(1, 2))],
         'child': [('start', 1), ('ideal', Fraction(3, 2)), ('extra', Fraction(1, 2))],
         'toddler': [('start', 1), ('extra', Fraction(1, 2))]}
STEPS_FR = [Fraction(1, 4), Fraction(1, 3), Fraction(1, 2), Fraction(2, 3), Fraction(3, 4), Fraction(1),
            Fraction(5, 4), Fraction(4, 3), Fraction(3, 2), Fraction(5, 3), Fraction(7, 4), Fraction(2),
            Fraction(9, 4), Fraction(5, 2), Fraction(3), Fraction(7, 2), Fraction(4), Fraction(9, 2), Fraction(5),
            Fraction(6)]
GLYPH = {Fraction(1, 4): '¼', Fraction(1, 3): '⅓', Fraction(1, 2): '½', Fraction(2, 3): '⅔', Fraction(3, 4): '¾'}


def up(x):
    """Smallest household fraction >= x (never rounds a portion down)."""
    for f in STEPS_FR:
        if f >= x:
            return f
    sys.exit(f'portion {x} too large')


def fr_text(f):
    whole, part = divmod(f, 1)
    if part == 0:
        return str(int(whole))
    return (str(int(whole)) if whole else '') + GLYPH[part]


def stage_units(kind, stage):
    unit, plural, gpu, adult, older, child, toddler, role = REF[kind]
    if stage in ('adult', 'teen'):
        return up(Fraction(adult))
    if stage == 'older_adult':
        return up(Fraction(adult) * (older if kind in CEREAL else 1))
    share = child if stage == 'child' else toddler
    return None if share is None else up(Fraction(adult) * share)


def measure(kind, units):
    unit, plural = REF[kind][0], REF[kind][1]
    return f'{fr_text(units)} {unit if units <= 1 else plural}'


def grams_of(kind, units):
    return (Decimal(units.numerator) * Decimal(REF[kind][2]) / Decimal(units.denominator)).quantize(
        Decimal('0.1'), rounding=ROUND_HALF_UP)


# ---- meals --------------------------------------------------------------------------------------------
# code: B breakfast, L lunch, D dinner, S snack, U suhoor, I iftar. Components are recipe titles, or
# ('ingredient', <catalog name>, <label>, <kind>) for a plain item. Plate split templates (adult plate,
# 06 section 4.3 band for lunch and dinner: veg_fruit 0.40 to 0.60, protein 0.20 to 0.30, carb 0.20 to 0.30).
PS_MAIN = {'veg_fruit': 0.5, 'protein': 0.25, 'carb': 0.25}
PS_RICE = {'veg_fruit': 0.45, 'protein': 0.25, 'carb': 0.3}
PS_BREAKFAST = {'veg_fruit': 0.3, 'protein': 0.3, 'carb': 0.4}
PS_SNACK = {'veg_fruit': 0.5, 'protein': 0.2, 'carb': 0.3}
ROTI, RICE, KACH, KHEERA, HARA = 'Roti (chapati)', 'Plain boiled basmati', 'Kachumber salad', 'Kheera raita', 'Hara salad'
DATES = 'Khajoor aur badam'

MEALS = []


def meal(code, meal_type, comps, ps=None):
    MEALS.append(dict(code=code, meal_type=meal_type, comps=list(comps), ps=ps))


DINNERS = [
    ['Masoor daal', ROTI, KACH], ['Chicken lauki salan', ROTI, KACH], ['Fish salan', RICE, KACH],
    ['Aloo gosht', ROTI, HARA], ['Lobia masala', RICE, 'Podina raita'], ['Chicken karahi', ROTI, KACH],
    ['Shami kabab', 'Aloo palak', ROTI], ['Palak murgh', ROTI, KHEERA], ['Daal gosht', ROTI, KACH],
    ['Baked rohu with lemon', 'Aloo gajar', ROTI], ['Chicken salan', 'Zeera rice', HARA],
    ['Rajma masala', RICE, KACH], ['Qeema matar', ROTI, KHEERA], ['Haleem', ROTI, KACH],
    ['Moong daal khichri', KHEERA, HARA], ['Mutton shorba', ROTI, KACH], ['Chicken jalfrezi', ROTI, 'Lauki raita'],
    ['Aloo gobhi', 'Masoor daal', ROTI], ['Bhindi gosht', ROTI, KACH], ['Fish tikka (tawa)', 'Kaddu masala', ROTI],
    ['Murgh cholay', ROTI, KACH], ['Sarson ka saag', 'Makai ki roti', 'Namkeen lassi'], ['Shalgam gosht', ROTI, HARA],
    ['Chicken shorba', RICE, KACH], ['Beef kofta curry', ROTI, KHEERA], ['Lauki gosht', ROTI, KACH],
    ['Arhar daal tarka', RICE, 'Aloo baingan'], ['Chicken qorma', ROTI, KACH], ['Palak qeema', ROTI, 'Mix sabzi raita'],
    ['Mutton qorma', ROTI, HARA], ['Prawn karahi', ROTI, KACH], ['Gobhi gosht', ROTI, KHEERA],
    ['Kaddu chana daal', 'Jau ki roti', HARA], ['Chicken handi', ROTI, KACH], ['Nargisi kofta', ROTI, HARA],
    ['Mutton karahi', ROTI, KACH], ['Seekh kabab', 'Mix sabzi', ROTI], ['Achari murgh', ROTI, KHEERA],
    ['Lauki kofta curry', RICE, KACH], ['Chicken kofta curry', ROTI, HARA], ['Arvi gosht', ROTI, KACH],
    ['Chicken white karahi', ROTI, HARA], ['Masoor shorba', 'Chicken reshmi kabab', HARA],
    ['Beef nihari', ROTI, KACH], ['Karela qeema', ROTI, KHEERA], ['Mutton pulao', KHEERA, KACH],
    ['Chicken biryani', KHEERA, KACH], ['Beef pulao', 'Podina raita', KACH],
    ['Chicken vegetable soup', 'Daal atta roti', HARA], ['Dum aloo', 'Masoor daal', ROTI],
]
LUNCHES = [
    ['Chicken roti roll', 'Mausami phal plate'], ['Masoor daal', RICE, KACH], ['Fish roti roll', HARA],
    ['Egg sandwich', 'Mausami phal plate'], ['Chana pulao', KHEERA, KACH], ['Matar pulao', KHEERA, KACH],
    ['Tahari', 'Mix sabzi raita', HARA], ['Vegetable pulao', 'Podina raita', KACH], ['Masoor khichri', 'Lauki raita', HARA],
    ['Jau moong khichri', KHEERA, KACH], ['Desi fried rice', KACH, 'Lauki raita'], ['Aloo chanay', ROTI, KACH],
    ['Lobia aloo', ROTI, KACH], ['Sabut mash daal', ROTI, HARA], ['Daal mash (Lahori dry)', ROTI, KACH],
    ['Chana daal tarka', 'Zeera rice', KACH], ['Mixed daal', ROTI, KHEERA], ['Moong palak daal', RICE, KACH],
    ['Palak daal', ROTI, KACH], ['Bhindi masala', 'Masoor daal', ROTI], ['Aloo matar', ROTI, KHEERA],
    ['Mix sabzi', 'Moong daal', ROTI], ['Khumbi matar', ROTI, HARA], ['Baghare baingan', RICE, KHEERA],
    ['Anda curry', ROTI, KACH], ['Aloo anday', ROTI, KACH], ['Chicken mayo sandwich', HARA],
    ['Tuna aloo cutlets', ROTI, HARA], ['Chicken shashlik', RICE, HARA], ['Rajma masala', 'Zeera rice', KHEERA],
    ['Karela pyaz', 'Masoor daal', ROTI], ['Lauki chana daal', ROTI, KACH], ['Sabut masoor', RICE, KACH],
    ['Shimla mirch qeema', ROTI, KHEERA], ['Sookhi moong daal', 'Palak roti', 'Mix sabzi raita'],
]
BREAKFASTS = [
    ['Oats with milk and dates', 'Mausami phal plate'], ['Masala omelette', ROTI], ['Anday ka khagina', ROTI],
    ['Talbina', 'Boiled eggs'], ['Meetha daliya', 'Boiled eggs'], ['Namkeen daliya', 'Boiled eggs'],
    ['Besan cheela', KHEERA], ['Moong daal cheela', 'Podina chutney', 'Mausami phal plate'],
    ['Aloo paratha', KHEERA], ['Gobhi paratha', 'Mix sabzi raita'], ['Mooli paratha', 'Podina raita'],
    ['Anda paratha', 'Mausami phal plate'], ['Timatar anday', ROTI], ['Palak anday', ROTI], ['Cheese omelette', ROTI],
    ['Dahi oats with fruit'], ['Apple darchini daliya', 'Boiled eggs'], ['Egg sandwich', 'Banana milkshake'],
    ['Lahori chanay', ROTI], ['Meethi seviyan', 'Boiled eggs'], ['Dahi with honey and banana', 'Boiled eggs'],
    ['Missi roti', 'Anday ka khagina'],
]
SNACKS = [
    ['Mausami phal plate'], ['Fruit chaat'], ['Chana chaat'], ['Dahi with honey and banana'], ['Khajoor ke laddu'],
    ['Banana milkshake'], ['Meethi lassi'], ['Shakarkandi chaat'], ['Makai chaat'], ['Boiled eggs'],
    ['Aloo tikki', 'Imli chutney'], ['Daal ke kabab', 'Podina chutney'], ['Phal raita'], ['Kheer'], ['Chana salad'],
    ['Haldi doodh'], ['Gajar ka halwa'], ['Firni'], ['Fruit custard'], ['Pakoray', 'Imli chutney'],
    ['Samosa (potato)', 'Imli chutney'], ['Qeema samosa', 'Podina chutney'],
]
SUHOORS = [
    ['Oats with milk and dates', 'Boiled eggs'], ['Plain paratha', 'Anday ka khagina', 'Meethi lassi'],
    ['Talbina', DATES], ['Moong daal khichri', KHEERA], ['Missi roti', 'Boiled eggs', 'Namkeen lassi'],
    ['Aloo paratha', 'Namkeen lassi'], ['Masala omelette', ROTI, 'Dahi with honey and banana'],
    ['Plain paratha', 'Boiled eggs', 'Aam lassi'],
]
IFTARS = [
    [DATES, 'Fruit chaat', 'Shikanjvi'], [DATES, 'Pakoray', 'Imli chutney', 'Shikanjvi'], [DATES, 'Chana chaat', 'Shikanjvi'],
    [DATES, 'Samosa (potato)', 'Podina chutney'], [DATES, 'Dahi baray', 'Fruit chaat'], ['Chicken corn soup', DATES],
    ['Mutton yakhni', DATES], ['Masoor shorba', DATES], [DATES, 'Aloo tikki', 'Imli chutney'],
    ['Khajoor wala doodh', 'Fruit chaat'],
]
for prefix, meal_type, rows, ps in (('D', 'dinner', DINNERS, None), ('L', 'lunch', LUNCHES, None),
                                     ('B', 'breakfast', BREAKFASTS, PS_BREAKFAST), ('S', 'snack', SNACKS, PS_SNACK),
                                     ('U', 'suhoor', SUHOORS, PS_BREAKFAST), ('I', 'iftar', IFTARS, PS_SNACK)):
    for n, comps in enumerate(rows, 1):
        meal(f'{prefix}{n:03d}', meal_type, comps, ps)

CUCUMBER_STICKS = ('ingredient', 'Cucumber (kheera)', 'Cucumber sticks', 'salad')
CHILD_TASKS = ['top_own_bowl', 'squeeze_lemon', 'roll_own_roti', 'peel_egg']
WET = {'curry', 'soup'}


def protein_family(recipe):
    names = ' '.join(i['name'] for i in recipe['ings'] if not i['optional']).lower()
    if any(w in names for w in ('mutton', 'beef')):
        return 'red'
    if 'chicken' in names:
        return 'chicken'
    if any(w in names for w in ('fish', 'prawn', 'tuna')):
        return 'fish'
    if 'egg' in names:
        return 'egg'
    return 'veg'


def build_meals(recipes, catalog):
    by_title = {r['title']: r for r in recipes}
    for r in recipes:
        r['kind'] = r.get('kind') or KIND.get(r['title'])
        if r['kind'] not in REF:
            sys.exit(f'{r["title"]}: no portion family (kind)')

    def comp(c, presentation=None):
        if isinstance(c, tuple):
            _, ing, label, kind = c
            if ing not in catalog:
                sys.exit(f'meal component ingredient {ing!r} is not in 040')
            d = {'ingredient': ing, 'label': label, 'role': 'side', 'kind': kind}
        else:
            if c not in by_title:
                sys.exit(f'meal component {c!r} is not a catalog recipe')
            r = by_title[c]
            d = {'recipe': c, 'role': REF[r['kind']][7], 'kind': r['kind']}
        if presentation:
            d['presentation'] = presentation
        return d

    base = []
    for m in MEALS:
        comps = [comp(c) for c in m['comps']]
        main = by_title[m['comps'][0]] if not isinstance(m['comps'][0], tuple) else None
        if m['meal_type'] not in main['meals'] and m['meal_type'] not in ('suhoor', 'iftar', 'snack'):
            sys.exit(f'{m["code"]}: {main["title"]} is not a {m["meal_type"]} recipe')
        ps = m['ps'] or (PS_RICE if any(c.get('kind') in ('rice_main', 'rice_side') for c in comps) else PS_MAIN)
        title = ' + '.join(c['recipe'] if 'recipe' in c else c['label'] for c in comps)
        base.append(dict(code=m['code'], meal_type=m['meal_type'], title=title, comps=comps, ps=ps, main=main))

    adapted, alts = [], []
    for m in base:
        if m['meal_type'] not in ('lunch', 'dinner'):
            continue
        # autism (14 section 7): deconstructed, sauce on the side, child portion lifted before chilli, raw
        # mixed-texture salad replaced by plain cucumber sticks; every component servable plain
        a_comps = []
        for c in m['comps']:
            if c.get('kind') == 'salad':
                continue
            pres = {'separate_components': True, 'plate': 'divided_3', 'spice_level': 0,
                    'sauce_on_side': c.get('kind') in WET, 'servable_plain': True}
            if c.get('kind') == 'roti':
                pres['cut_shape'] = 'strips'
            a_comps.append(dict(c, presentation=pres))
        a_comps.append(comp(CUCUMBER_STICKS, {'separate_components': True, 'plate': 'divided_3', 'spice_level': 0,
                                              'cut_shape': 'strips', 'servable_plain': True}))
        a_code = m['code'] + '-A'
        adapted.append(dict(code=a_code, meal_type=m['meal_type'], comps=a_comps, ps=m['ps'],
                            title=('Deconstructed: ' + ' + '.join(c['recipe'] if 'recipe' in c else c['label']
                                                                 for c in a_comps))[:160]))
        alts.append((m['code'], a_code, 'autism',
                     'Same family meal served deconstructed on a divided plate: sauce on the side, the child '
                     'portion lifted out before chilli is added, plain cucumber sticks as the crunchy side. '
                     'Add the child\'s safe food in the free section.'))
        # picky (14 section 7.2 rule 3): the family meal stays, plus a familiar plain carb and a child task
        task = CHILD_TASKS[int(m['code'][1:]) % len(CHILD_TASKS)]
        p_comps = [dict(c, presentation={'spice_level': 1, 'child_task_key': task}) for c in m['comps']]
        if not any(c.get('kind') in ('roti', 'rice_side', 'rice_main') for c in m['comps']):
            p_comps.append(comp(ROTI, {'spice_level': 0, 'child_task_key': task}))
        p_code = m['code'] + '-P'
        adapted.append(dict(code=p_code, meal_type=m['meal_type'], comps=p_comps, ps=m['ps'],
                            title=('Family plate, picky-eater serve: ' + m['title'])[:160]))
        alts.append((m['code'], p_code, 'picky',
                     'Keep the family meal: a small first serving next to a familiar plain carb, seconds always '
                     f'allowed, no pressure. Child task: {task.replace("_", " ")}.'))

    # budget: a lower-cost meal of the same type and protein family (chicken stands in for red meat and fish)
    for m in base:
        if m['meal_type'] not in ('lunch', 'dinner') or m['main']['cost'] < 3:
            continue
        fam = protein_family(m['main'])
        want = [fam, 'chicken'] if fam in ('red', 'fish') else [fam]
        cand = [o for f in want for o in base
                if o['meal_type'] == m['meal_type'] and o['main']['cost'] <= 2 and protein_family(o['main']) == f]
        if cand:
            alts.append((m['code'], cand[0]['code'], 'budget',
                         f'Lower-cost swap: {cand[0]["main"]["title"]} instead of {m["main"]["title"]}.'))
    meals = base + adapted
    codes = [m['code'] for m in meals]
    if len(codes) != len(set(codes)):
        sys.exit('duplicate meal code')
    for m in meals:
        ps = m['ps']
        if abs(sum(ps.values()) - 1) > 0.05:
            sys.exit(f'{m["code"]}: plate split does not sum to 1')
        if m['meal_type'] in ('lunch', 'dinner') and not (0.4 <= ps['veg_fruit'] <= 0.6 and 0.2 <= ps['protein'] <= 0.3
                                                          and 0.2 <= ps['carb'] <= 0.3):
            sys.exit(f'{m["code"]}: plate split outside the 06 band')
    return meals, alts, by_title


def recipe_portions(recipes):
    """Reference serving per recipe and life stage (tier 'standard'): the 'reference portion'."""
    rows = []
    for r in recipes:
        kind = r['kind']
        adult = stage_units(kind, 'adult')
        for st in STAGES:
            u = stage_units(kind, st)
            if u is None:
                continue
            kcal = None
            if st in ('adult', 'older_adult') and 'kcal' in r['nut']:   # stored for adults only (05 7.9)
                kcal = rnd(r['nut']['kcal'] * Decimal(u.numerator) / Decimal(u.denominator)
                           * Decimal(adult.denominator) / Decimal(adult.numerator), 1)
            rows.append((r['title'], st, 'standard', grams_of(kind, u), measure(kind, u), kcal))
    return rows


def meal_portions(meals, by_title, catalog):
    rows = []
    for m in meals:
        for st in STAGES:
            for tier, mult in TIERS[st]:
                grams, parts, kcal = Decimal(0), [], Decimal(0)
                for c in m['comps']:
                    ref = stage_units(c['kind'], st)
                    if ref is None:          # adult-only item (tea): not part of a minor's serving
                        continue
                    u = up(ref * mult)
                    g = grams_of(c['kind'], u)
                    grams += g
                    name = c['recipe'] if 'recipe' in c else c['label']
                    parts.append(f'{name}, {measure(c["kind"], u)}')
                    if 'recipe' in c:
                        r = by_title[c['recipe']]
                        adult = stage_units(c['kind'], 'adult')
                        kcal += r['nut'].get('kcal', Decimal(0)) * Decimal(u.numerator) / Decimal(u.denominator) \
                            * Decimal(adult.denominator) / Decimal(adult.numerator)
                    else:
                        kcal += (catalog[c['ingredient']]['kcal'] or Decimal(0)) * g / 100
                text = ('+ ' if tier == 'extra' else '') + '; '.join(parts)
                rows.append((m['code'], st, tier, grams, text,
                             rnd(kcal, 1) if st in ('adult', 'older_adult') else None))
    return rows


# ---- Punjab seasonal produce (14 section 15) -------------------------------------------------------------
# One string per item, Jan..Dec: P peak, A available, S scarce, . not in market (no row).
SEASON = {
    'Cauliflower (phool gobhi)': 'PPASSSSSSAPP', 'Cabbage (band gobhi)': 'PPASSSSSSAPP', 'Carrot (gajar)': 'PPAS.....SAP',
    'Turnip (shalgam)': 'PAS......APP', 'Radish (mooli)': 'PPASSSSSSAPP', 'Spinach (palak)': 'PPASSSSSSAPP',
    'Mustard greens (sarson)': 'PPA.......AP', 'Green peas (matar)': 'PPAS.....SAP', 'Potato': 'PPPAAAAAAAPP',
    'Onion': 'AAAPPPAAAAPP', 'Tomato': 'AAPPPASSSPPP', 'Sweet potato (shakarkandi)': 'PAS......APP',
    'Pumpkin (kaddu)': 'SSSSSAAAPPPA', 'Bottle gourd (lauki)': 'SSAAPPPPPPAS', 'Okra (bhindi)': '..SAPPPPAS..',
    'Bitter gourd (karela)': '..SAPPPPAA..', 'Ridge gourd (tori)': '...SAPPPPA..', 'Eggplant (baingan)': 'AAAAAPPPPPPA',
    'Cucumber (kheera)': 'SSAPPPPPPAAS', 'Taro root (arvi)': '.....SAPPPA.', 'Sweet corn (makai)': '.....SPPPA..',
    'Capsicum (shimla mirch)': 'AAASSSSSSAAA', 'Coriander leaves (hara dhaniya)': 'PPPASSSSAPPP',
    'Mint (podina)': 'AAAPPPPPPAAA', 'Lemon (leemu)': 'AAASSSAPPPPA', 'Garlic (lehsan)': 'AAAAAAAAAAAA',
    'Ginger (adrak)': 'AAAAAAAAAAAA',
    'Guava (amrood)': 'ASSSSSSAAPPP', 'Kinnow (mandarin)': 'PPAS......AP', 'Banana': 'PPPAAAAAAPPP',
    'Apple (saib)': 'AAASSSSAPPPA', 'Pomegranate (anaar)': 'SS.....APPPA', 'Papaya (papita)': 'AAAAAAAAAAAA',
    'Strawberry': 'APPA.......S', 'Mango (aam)': '....APPPA...', 'Melon (kharbooza)': '...APPPA....',
    'Watermelon (tarbooz)': '...APPPA....', 'Lychee (leechi)': '....SPA.....', 'Apricot (khubani)': '....APP.....',
    'Peach (aaru)': '....SPPA....', 'Plum (aloo bukhara)': '.....PPA....', 'Pear (nashpati)': '......PPAA..',
    'Grapes (angoor)': '.....APPPA..', 'Dates (Aseel)': 'AAAAAAAAAAAA',
    # not in the 14 section 15 tables: well-known Punjab market seasons, to be checked by ops (see header)
    'Orange (malta)': 'PPA.......SA', 'Beetroot (chukandar)': 'PPA.......AP', 'Green beans (phaliyan)': 'AASS.....AAA',
    'Lotus root (kamal kakri)': 'PA........AP', 'Lettuce (salad patta)': 'PPA.......AP',
    'Spring onion (hara pyaz)': 'PPA.......AP', 'Drumstick pods (sohanjna)': '..PPA.......',
    'Figs, fresh (anjeer)': '......AA....',
}
PRICE_INDEX = {'P': '0.75', 'A': '1.00', 'S': '1.45'}   # 14 section 15.4 defaults
AVAIL = {'P': 'peak', 'A': 'available', 'S': 'scarce'}


MEALS_HEADER = """-- supabase/seed/catalog/092_meals.sql
-- GENERATED by tooling/scripts/gen-recipe-seed.py; edit the meal list there and re-run.
-- Global meal library (S3-02 seed, S3-16), built only from the 090 catalog recipes and 040 ingredients:
--   * {n_base} family meals keyed by meals.code (B breakfast, L lunch, D dinner, S snack, U suhoor, I iftar),
--     plus {n_adapted} adapted variants for every lunch and dinner: '<code>-A' (autism: deconstructed, divided plate,
--     sauce on the side, chilli-free child portion, cucumber sticks) and '<code>-P' (picky eater: the family meal
--     with a familiar plain carb and a child task). Presentation metadata sits in components[].presentation.
--   * portions: {n_recipe_portions} reference servings per recipe and life stage (tier 'standard'), and {n_meal_portions}
--     meal portions: adult and older_adult 'standard', teen 'ideal' + 'extra', child 'start' + 'ideal' + 'extra',
--     toddler 'start' + 'extra'. 'extra' is the second helping on top of 'start'. Infants get none.
--   * meal_alternatives: {n_alts} rows ({n_autism} autism, {n_picky} picky, {n_budget} budget).
-- Portion basis: Pakistan Dietary Guidelines for Better Nutrition (2018) serving definitions in the 14
-- section 6.2 household measures; child reference = 1/2 adult, toddler = 1/3 adult, rounded UP to the next
-- household fraction; children's tiers are multiples (>= 1) of their reference and never scaled down
-- (14 section 6.4). grams are cooked plate weights. kcal is stored for adult and older_adult rows only and
-- assumes one adult reference serving = one recipe serving (per_serving_nutrition).
-- Idempotent: meals key on code, portions on (meal_id | recipe_id, life_stage, tier), alternatives on
-- (meal_id, alternative_meal_id, reason); existing rows are left alone so review edits survive a re-run.
--
-- REVIEW REQUIRED: every meal, portion and alternative loads as review_status 'in_review'. Users see
-- them only after a registered dietitian sets them 'verified' (or, in thuluth-dev / staging only, while
-- feature flag catalog.include_in_review is on). The dietitian checks: the reference serving per life
-- stage and family (REF in the generator), the older-adult cereal share, the child and toddler shares,
-- grams per household measure, the kcal assumption above, the plate splits, the autism and picky
-- presentations, and the budget pairs. No Urdu text is seeded (household_measure_i18n is English only).
"""

SEASON_HEADER = """-- supabase/seed/catalog/095_seasonal_produce.sql
-- GENERATED by tooling/scripts/gen-recipe-seed.py; edit SEASON there and re-run.
-- Punjab (regions PK/PB, used for Lahore and Islamabad) produce calendar from 14 section 15 (curated from
-- Punjab agricultural calendars and Lahore market experience). Items 14 lists that are not in the 040
-- catalog (fenugreek leaves, apple gourd, musambi, persimmon, loquat, jamun, fresh dates) are skipped.
-- Eight items not in the 14 tables are added from well-known Punjab market seasons: orange (malta),
-- beetroot, green beans, lotus root, lettuce, spring onion, drumstick pods, fresh figs.
-- price_index uses the 14 section 15.4 defaults (peak 0.75, available 1.00, scarce 1.45) until
-- prices-refresh (S4) recomputes it. A '.' month has no row (not normally in market).
-- REVIEW REQUIRED: ops validates every row against Lahore Market Committee rate lists (14 section 15).
-- Idempotent: upsert on (region_id, ingredient_id, month) keeps admin edits (do nothing).
"""


def render_meals(meals, alts, rportions, mportions):
    n_base = sum(1 for m in meals if '-' not in m['code'])
    out = [MEALS_HEADER.format(
        n_base=n_base, n_adapted=len(meals) - n_base, n_recipe_portions=len(rportions),
        n_meal_portions=len(mportions), n_alts=len(alts),
        n_autism=sum(a[2] == 'autism' for a in alts), n_picky=sum(a[2] == 'picky' for a in alts),
        n_budget=sum(a[2] == 'budget' for a in alts))]
    out.append('insert into public.meals (code, title, title_i18n, meal_type, components, plate_split, source, review_status)\n'
               'select v.code, v.title, jsonb_build_object(\'en\', v.title), v.meal_type::public.meal_type,\n'
               '       (select jsonb_agg(case when c ? \'recipe\'\n'
               '                              then (c - \'recipe\' - \'kind\') || jsonb_build_object(\'recipe_id\', r.id)\n'
               '                              else (c - \'ingredient\' - \'kind\') || jsonb_build_object(\'ingredient_ids\', jsonb_build_array(i.id)) end\n'
               '                         order by e.ord)\n'
               '          from jsonb_array_elements(v.spec) with ordinality e(c, ord)\n'
               '          left join public.recipes r on lower(r.title) = lower(c ->> \'recipe\') and r.household_id is null\n'
               '          left join public.ingredients i on lower(i.name) = lower(c ->> \'ingredient\')),\n'
               '       v.plate_split, \'curated\', \'in_review\'\n'
               'from (values')
    vals = []
    for m in meals:
        spec = [dict({k: v for k, v in c.items()}, servings_share=1) for c in m['comps']]
        vals.append('  (' + ', '.join([q(m['code']), q(m['title']), q(m['meal_type']),
                                      q(json.dumps(spec, ensure_ascii=False)) + '::jsonb',
                                      q(json.dumps(m['ps'])) + '::jsonb']) + ')')
    out.append(',\n'.join(vals))
    out.append(') v(code, title, meal_type, spec, plate_split)\n'
               'on conflict (code) where code is not null do nothing;\n')
    out.append('-- guard: every component resolved to a catalog recipe or ingredient\n'
               'do $$\ndeclare v_bad text;\nbegin\n'
               '  select string_agg(m.code, \', \') into v_bad from public.meals m, jsonb_array_elements(m.components) c\n'
               '   where m.code is not null and m.household_id is null\n'
               '     and coalesce(c ->> \'recipe_id\', c -> \'ingredient_ids\' ->> 0) is null;\n'
               '  if v_bad is not null then\n'
               '    raise exception \'092_meals: unresolved components in %\', v_bad;\n'
               '  end if;\nend $$;\n')

    def portion_values(rows):
        return ',\n'.join('  (' + ', '.join([q(k), q(st), q(t), format(g, 'f'), q(txt),
                                             q(json.dumps({'en': txt}, ensure_ascii=False)) + '::jsonb',
                                             format(kc, 'f') if kc is not None else 'null']) + ')'
                          for k, st, t, g, txt, kc in rows)

    out.append('-- reference servings per recipe and life stage\n'
               'insert into public.portions (recipe_id, life_stage, tier, grams, household_measure, household_measure_i18n,\n'
               '  kcal, review_status)\n'
               'select r.id, v.life_stage::public.life_stage, v.tier, v.grams, v.measure, v.measure_i18n, v.kcal, \'in_review\'\n'
               'from (values')
    out.append(portion_values(rportions))
    out.append(') v(title, life_stage, tier, grams, measure, measure_i18n, kcal)\n'
               'join public.recipes r on lower(r.title) = lower(v.title) and r.household_id is null\n'
               'on conflict (recipe_id, life_stage, tier) where recipe_id is not null do nothing;\n')
    out.append('-- meal portions per life stage and tier\n'
               'insert into public.portions (meal_id, life_stage, tier, grams, household_measure, household_measure_i18n,\n'
               '  kcal, review_status)\n'
               'select m.id, v.life_stage::public.life_stage, v.tier, v.grams, v.measure, v.measure_i18n, v.kcal, \'in_review\'\n'
               'from (values')
    out.append(portion_values(mportions))
    out.append(') v(code, life_stage, tier, grams, measure, measure_i18n, kcal)\n'
               'join public.meals m on m.code = v.code\n'
               'on conflict (meal_id, life_stage, tier) where meal_id is not null do nothing;\n')
    out.append('insert into public.meal_alternatives (meal_id, alternative_meal_id, reason, notes, review_status)\n'
               'select m.id, a.id, v.reason, v.notes, \'in_review\'\nfrom (values')
    out.append(',\n'.join(f'  ({q(a)}, {q(b)}, {q(r)}, {q(n)})' for a, b, r, n in alts))
    out.append(') v(code, alt_code, reason, notes)\n'
               'join public.meals m on m.code = v.code\n'
               'join public.meals a on a.code = v.alt_code\n'
               'on conflict (meal_id, alternative_meal_id, reason) do nothing;\n')
    return '\n'.join(out)


def render_season(catalog):
    rows = []
    for name, months in SEASON.items():
        if name not in catalog:
            sys.exit(f'seasonal item {name!r} is not in 040')
        if len(months) != 12:
            sys.exit(f'{name}: need 12 months')
        for mth, ch in enumerate(months, 1):
            if ch != '.':
                rows.append(f'  ({q(name)}, {mth}, {q(AVAIL[ch])}, {PRICE_INDEX[ch]})')
    return (SEASON_HEADER
            + 'insert into public.seasonal_produce (region_id, ingredient_id, month, availability, price_index)\n'
            + 'select r.id, i.id, v.month, v.availability, v.price_index\nfrom (values\n'
            + ',\n'.join(rows)
            + '\n) v(ingredient, month, availability, price_index)\n'
            + "join public.regions r on r.country_code = 'PK' and r.region_code = 'PB'\n"
            + 'join public.ingredients i on lower(i.name) = lower(v.ingredient)\n'
            + 'on conflict (region_id, ingredient_id, month) do nothing;\n'), len(rows)


def main():
    recipes, catalog = build()
    meals, alts, by_title = build_meals(recipes, catalog)
    season_sql, _ = render_season(catalog)
    outputs = {
        OUT_SQL: render(recipes),
        MEALS_SQL: render_meals(meals, alts, recipe_portions(recipes), meal_portions(meals, by_title, catalog)),
        SEASON_SQL: season_sql,
    }
    if '--check' in sys.argv:
        stale = []
        for path, sql in outputs.items():
            try:
                with open(path, encoding='utf-8') as fh:
                    if fh.read() != sql:
                        stale.append(os.path.basename(path))
            except FileNotFoundError:
                stale.append(os.path.basename(path))
        if stale:
            sys.exit(f'{", ".join(stale)} stale: run tooling/scripts/gen-recipe-seed.py')
        print('090_recipes.sql, 092_meals.sql and 095_seasonal_produce.sql are up to date')
        return
    for path, sql in outputs.items():
        with open(path, 'w', encoding='utf-8') as fh:
            fh.write(sql)
        print(f'wrote {path}')


if __name__ == '__main__':
    main()
