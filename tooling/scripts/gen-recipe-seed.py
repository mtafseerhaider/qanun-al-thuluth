#!/usr/bin/env python3
"""Generate supabase/seed/catalog/090_recipes.sql (S2-16): 100 curated Pakistani home recipes.

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

getcontext().prec = 40

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
ING_SQL = os.path.join(ROOT, 'supabase', 'seed', 'catalog', '040_ingredients.sql')
OUT_SQL = os.path.join(ROOT, 'supabase', 'seed', 'catalog', '090_recipes.sql')

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


def rec(title, meals, servings, prep, cook, cost, flags, textures, colors, ings, steps, region=None):
    R.append(dict(title=title, meals=meals, servings=servings, prep=prep, cook=cook, cost=cost,
                  flags=flags, textures=textures, colors=colors, ings=ings, steps=steps,
                  region=region or STD))


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
    if len(recipes) != 100:
        sys.exit(f'expected 100 recipes, have {len(recipes)}')
    return recipes


HEADER = """-- supabase/seed/catalog/090_recipes.sql
-- GENERATED by tooling/scripts/gen-recipe-seed.py; edit the recipe list there and re-run.
-- 100 curated Pakistani (Lahore / Punjab home-style) recipes for the global catalog (S2-16).
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


def main():
    sql = render(build())
    if '--check' in sys.argv:
        with open(OUT_SQL, encoding='utf-8') as fh:
            if fh.read() != sql:
                sys.exit('090_recipes.sql is stale: run tooling/scripts/gen-recipe-seed.py')
        print('090_recipes.sql is up to date')
        return
    with open(OUT_SQL, 'w', encoding='utf-8') as fh:
        fh.write(sql)
    print(f'wrote {OUT_SQL}')


if __name__ == '__main__':
    main()
