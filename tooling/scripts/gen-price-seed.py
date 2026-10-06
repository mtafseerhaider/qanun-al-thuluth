#!/usr/bin/env python3
"""Generate the Sprint 4 price-book and regional produce seeds (S4-03):

  supabase/seed/catalog/080_price_books.sql            Lahore, Karachi and Islamabad price books, October 2026
  supabase/seed/catalog/096_seasonal_produce_sd_is.sql Sindh (Karachi) and ICT (Islamabad) produce calendars

PRICING METHOD (no live price source was available when this was written):

1. Lahore. 58 of the 150 catalog ingredients take their price directly from the reference Lahore basket
   in 14-meal-planning-and-grocery.md section 16.2 ("Approximate Lahore retail, October 2026 estimates
   from the reference program"; 05 section 19 order 8). Those rows are marked `doc` below. Where 14 prices
   a group ("green chillies, coriander, mint" as a weekly lot, "spice refill" as a monthly lot, "cheese
   block", "canola or sunflower oil") the group price is applied to each member at its own purchase unit.
2. The other 92 ingredients are `est`: estimates placed relative to the nearest basket item using
   well-known Lahore retail price ratios (for example boneless chicken about 1.75x chicken with bone,
   cauliflower and okra close to cabbage, mash daal about 1.7x masoor daal, whole spices priced per kg
   against kalonji and the spice refill lot, tandoor roti and naan at the usual per-piece prices). They
   are deliberately round numbers and are NOT market observations.
3. Karachi and Islamabad are derived from Lahore with the category multipliers in 14 section 16.3
   (rounded to the nearest PKR 5, or PKR 1 below PKR 100): produce_veg 1.08 / 1.10 (Sindh-grown tomato and onion 0.95 in Karachi
   for October to January), produce_fruit 1.05 / 1.08 (bananas 0.90 in Karachi, apples in season 0.95 in
   Islamabad), meat, poultry and eggs 1.05 / 1.08, fish 0.85 (sea fish) / 1.10 (river fish) in Karachi and
   1.15 in Islamabad, loose dairy 1.10 / 1.12, staples, plant protein, spices, oils, packaged dairy and
   beverages 1.02 / 1.04, snacks and dry fruit 1.00 / 0.98. 14 does not price river fish in Karachi; 1.10
   is an estimate ("river fish less common").
4. Every row is `source = 'seed'`, `observed_on = 2026-10-01`, `moderation_status = 'accepted'`, with an
   explicit `unit_grams`. Profile labels say "seed, ops review pending". Per 14 section 12.2 seed rows have
   trust weight 0.3 and stop mattering once 5 accepted non-seed observations exist in 60 days.
   `unit_grams` uses 14's figure where 14 gives one (eggs 660 g a dozen, milk 1030 g a litre, oils 920 g a
   litre) and the catalog `grams_per_unit` otherwise (kinnow 1800 g and malta 1560 g a dozen, not 14's
   generic 2400 g, so a grocery list built from recipe grams converts consistently).

REVIEW REQUIRED (ops): every `est` row, and the doc rows once more against Lahore Market Committee rate
lists and two retail checks, before the closed alpha relies on budget status; Karachi and Islamabad need
their own checks (14 section 16.3: monthly review until user reports dominate). The reference-basket
acceptance check (14 AC-G4, 01 FR-GRO-03) belongs to grocery-generate's tests.

SEASONAL: 095 (gen-recipe-seed.py) seeds the Punjab calendar. This script adds Sindh from 14 section 15.3
(bananas and papaya peak all year; tomato and onion peak October to January; mango peak May to July;
guava available November to February; leafy greens one level lower in winter, November to February;
surmai and prawns available all year, peak September to March) and ICT as the Punjab table with apples,
apricots and peaches one level higher in their season. Same price_index defaults as 095.

Usage:
  python3 tooling/scripts/gen-price-seed.py            # writes both files
  python3 tooling/scripts/gen-price-seed.py --check    # exits 1 if a committed file is stale
"""
import importlib.util
import os
import re
import sys
from decimal import ROUND_HALF_UP, Decimal

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
CAT = os.path.join(ROOT, 'supabase', 'seed', 'catalog')
ING_SQL = os.path.join(CAT, '040_ingredients.sql')
PRICE_SQL = os.path.join(CAT, '080_price_books.sql')
SEASON_SQL = os.path.join(CAT, '096_seasonal_produce_sd_is.sql')

OBSERVED_ON = '2026-10-01'

# name: (unit, unit_grams, lahore_pkr, basis, group)
#   basis: 'doc' = 14 section 16.2, 'est' = estimate (see method)
#   group: multiplier group for the derived cities
P = {
    # ---- vegetables and herbs ---------------------------------------------------------------------
    'Onion': ('kg', 1000, 120, 'doc', 'veg_sindh'),
    'Tomato': ('kg', 1000, 175, 'doc', 'veg_sindh'),
    'Potato': ('kg', 1000, 90, 'doc', 'veg'),
    'Bottle gourd (lauki)': ('kg', 1000, 160, 'doc', 'veg'),
    'Pumpkin (kaddu)': ('kg', 1000, 60, 'doc', 'veg'),
    'Spinach (palak)': ('kg', 1000, 100, 'doc', 'veg'),
    'Garlic (lehsan)': ('kg', 1000, 400, 'doc', 'veg'),
    'Ginger (adrak)': ('kg', 1000, 400, 'doc', 'veg'),
    'Green chilli (hari mirch)': ('kg', 1000, 200, 'est', 'veg'),   # share of the PKR 150/week chilli-coriander-mint lot
    'Carrot (gajar)': ('kg', 1000, 130, 'doc', 'veg'),
    'Cauliflower (phool gobhi)': ('kg', 1000, 140, 'est', 'veg'),
    'Cabbage (band gobhi)': ('kg', 1000, 130, 'doc', 'veg'),
    'Okra (bhindi)': ('kg', 1000, 220, 'est', 'veg'),
    'Eggplant (baingan)': ('kg', 1000, 120, 'est', 'veg'),
    'Bitter gourd (karela)': ('kg', 1000, 180, 'est', 'veg'),
    'Ridge gourd (tori)': ('kg', 1000, 160, 'est', 'veg'),
    'Turnip (shalgam)': ('kg', 1000, 90, 'doc', 'veg'),
    'Radish (mooli)': ('kg', 1000, 80, 'doc', 'veg'),
    'Green peas (matar)': ('kg', 1000, 250, 'doc', 'veg'),
    'Cucumber (kheera)': ('kg', 1000, 110, 'doc', 'veg'),
    'Capsicum (shimla mirch)': ('kg', 1000, 300, 'est', 'veg'),
    'Coriander leaves (hara dhaniya)': ('bunch', 100, 30, 'est', 'veg'),   # share of the weekly lot
    'Mint (podina)': ('bunch', 100, 30, 'est', 'veg'),                     # share of the weekly lot
    'Mustard greens (sarson)': ('kg', 1000, 120, 'est', 'veg'),
    'Lettuce (salad patta)': ('piece', 300, 100, 'est', 'veg'),
    'Sweet potato (shakarkandi)': ('kg', 1000, 100, 'doc', 'veg'),
    'Beetroot (chukandar)': ('kg', 1000, 120, 'est', 'veg'),
    'Green beans (phaliyan)': ('kg', 1000, 250, 'est', 'veg'),
    'Lotus root (kamal kakri)': ('kg', 1000, 400, 'est', 'veg'),
    'Taro root (arvi)': ('kg', 1000, 180, 'est', 'veg'),
    'Mushrooms (khumbi)': ('kg', 1000, 1200, 'est', 'veg'),
    'Spring onion (hara pyaz)': ('bunch', 100, 40, 'est', 'veg'),
    'Sweet corn (makai)': ('piece', 90, 60, 'est', 'veg'),
    'Drumstick pods (sohanjna)': ('kg', 1000, 300, 'est', 'veg'),
    # ---- fruit ------------------------------------------------------------------------------------
    'Banana': ('dozen', 1400, 180, 'doc', 'banana'),
    'Guava (amrood)': ('kg', 1000, 200, 'doc', 'fruit'),
    'Mango (aam)': ('kg', 1000, 350, 'est', 'fruit'),          # October is the scarce tail of the season
    'Apple (saib)': ('kg', 1000, 280, 'doc', 'apple'),
    'Kinnow (mandarin)': ('dozen', 1800, 250, 'est', 'fruit'),  # 14: oranges/kinnow 200 a dozen from November
    'Orange (malta)': ('dozen', 1560, 200, 'doc', 'fruit'),     # 14: oranges, musambi 200 a dozen
    'Pomegranate (anaar)': ('kg', 1000, 350, 'doc', 'fruit'),
    'Grapes (angoor)': ('kg', 1000, 400, 'est', 'fruit'),
    'Watermelon (tarbooz)': ('kg', 1000, 120, 'est', 'fruit'),
    'Melon (kharbooza)': ('kg', 1000, 150, 'est', 'fruit'),
    'Papaya (papita)': ('kg', 1000, 280, 'doc', 'fruit'),
    'Figs, fresh (anjeer)': ('kg', 1000, 800, 'est', 'fruit'),
    'Figs, dried (khushk anjeer)': ('kg', 1000, 4000, 'doc', 'snacks'),
    'Dates (Aseel)': ('kg', 1000, 600, 'doc', 'snacks'),
    'Apricot (khubani)': ('kg', 1000, 600, 'est', 'fruit'),
    'Apricots, dried (khushk khubani)': ('kg', 1000, 1800, 'est', 'snacks'),
    'Peach (aaru)': ('kg', 1000, 350, 'est', 'fruit'),
    'Plum (aloo bukhara)': ('kg', 1000, 400, 'est', 'fruit'),
    'Strawberry': ('kg', 1000, 800, 'est', 'fruit'),
    'Lychee (leechi)': ('kg', 1000, 900, 'est', 'fruit'),
    'Pear (nashpati)': ('kg', 1000, 300, 'est', 'fruit'),
    'Raisins (kishmish)': ('kg', 1000, 1600, 'doc', 'snacks'),
    'Lemon (leemu)': ('kg', 1000, 150, 'doc', 'fruit'),
    'Tamarind (imli)': ('kg', 1000, 600, 'est', 'shelf'),
    # ---- grains and breads ------------------------------------------------------------------------
    'Chakki atta (whole wheat flour)': ('kg', 1000, 135, 'doc', 'shelf'),
    'Maida (white flour)': ('kg', 1000, 150, 'est', 'shelf'),
    'Basmati rice (chawal)': ('kg', 1000, 420, 'doc', 'shelf'),     # 14: sella rice
    'Brown rice': ('kg', 1000, 550, 'doc', 'shelf'),
    'Whole barley (jau)': ('kg', 1000, 260, 'doc', 'shelf'),
    'Barley flour (jau ka atta)': ('kg', 1000, 300, 'est', 'shelf'),
    'Oats (jai)': ('kg', 1000, 700, 'doc', 'shelf'),
    'Semolina (sooji)': ('kg', 1000, 180, 'est', 'shelf'),
    'Vermicelli (seviyan)': ('pack', 200, 120, 'est', 'shelf'),
    'Maize flour (makai ka atta)': ('kg', 1000, 160, 'est', 'shelf'),
    'Millet (bajra)': ('kg', 1000, 200, 'est', 'shelf'),
    'Sorghum (jowar)': ('kg', 1000, 220, 'est', 'shelf'),
    'Broken wheat (daliya)': ('kg', 1000, 200, 'doc', 'shelf'),
    'Cornflour (corn starch)': ('pack', 300, 160, 'est', 'shelf'),
    'Roti (chapati), whole wheat': ('piece', 40, 20, 'est', 'shelf'),   # tandoor roti
    'Naan': ('piece', 90, 35, 'est', 'shelf'),
    'Paratha': ('piece', 80, 60, 'est', 'shelf'),
    'White bread (double roti)': ('pack', 600, 220, 'est', 'shelf'),
    # ---- legumes ----------------------------------------------------------------------------------
    'Masoor daal': ('kg', 1000, 300, 'doc', 'shelf'),
    'Whole masoor (brown lentils)': ('kg', 1000, 320, 'est', 'shelf'),
    'Kabuli chana': ('kg', 1000, 380, 'doc', 'shelf'),
    'Chana daal (split chickpeas)': ('kg', 1000, 310, 'doc', 'shelf'),
    'Moong (mung beans)': ('kg', 1000, 390, 'doc', 'shelf'),
    'Mash daal (urad)': ('kg', 1000, 520, 'est', 'shelf'),
    'Red kidney beans (lal lobia)': ('kg', 1000, 550, 'doc', 'shelf'),
    'Black-eyed beans (lobia)': ('kg', 1000, 420, 'est', 'shelf'),
    'Besan (gram flour)': ('kg', 1000, 320, 'doc', 'shelf'),
    'Peanuts (moongphali)': ('kg', 1000, 900, 'doc', 'snacks'),
    'Pigeon peas (arhar daal)': ('kg', 1000, 450, 'est', 'shelf'),
    # ---- meat, poultry, eggs, fish ----------------------------------------------------------------
    'Chicken, whole, with bone': ('kg', 1000, 570, 'doc', 'meat'),
    'Chicken breast, boneless': ('kg', 1000, 1000, 'est', 'meat'),
    'Chicken thigh, boneless': ('kg', 1000, 900, 'est', 'meat'),
    'Chicken liver (kaleji)': ('kg', 1000, 450, 'est', 'meat'),
    'Beef mince, lean': ('kg', 1000, 1400, 'doc', 'meat'),
    'Beef, boneless': ('kg', 1000, 1600, 'est', 'meat'),            # 14: curry cut with bone 1300
    'Mutton (goat meat)': ('kg', 1000, 2200, 'doc', 'meat'),
    'Beef liver (kaleji)': ('kg', 1000, 800, 'est', 'meat'),
    'Eggs, farm': ('dozen', 660, 315, 'doc', 'meat'),
    'Fish, rohu (carp)': ('kg', 1000, 750, 'doc', 'river_fish'),
    'Fish, surmai (king mackerel)': ('kg', 1000, 1500, 'est', 'sea_fish'),
    'Prawns (jhinga)': ('kg', 1000, 2200, 'est', 'sea_fish'),
    'Tuna, canned in water': ('pack', 185, 750, 'est', 'shelf'),
    # ---- dairy ------------------------------------------------------------------------------------
    'Fresh milk': ('l', 1030, 210, 'doc', 'loose_dairy'),
    'Buffalo milk': ('l', 1030, 230, 'est', 'loose_dairy'),
    'Yogurt (dahi)': ('kg', 1000, 250, 'est', 'loose_dairy'),
    'Butter (makhan)': ('pack', 200, 650, 'est', 'shelf'),
    'Cream (malai)': ('pack', 200, 250, 'est', 'shelf'),
    'Cheddar cheese': ('kg', 1000, 2400, 'doc', 'shelf'),
    'Mozzarella cheese': ('kg', 1000, 2400, 'doc', 'shelf'),
    'Milk powder': ('kg', 1000, 2700, 'est', 'shelf'),
    'Condensed milk': ('pack', 397, 550, 'est', 'shelf'),
    'Buttermilk (chhaach)': ('l', 1030, 120, 'est', 'loose_dairy'),
    # ---- nuts and seeds ---------------------------------------------------------------------------
    'Almonds (badam)': ('kg', 1000, 3600, 'doc', 'snacks'),
    'Walnuts (akhrot)': ('kg', 1000, 3000, 'doc', 'snacks'),
    'Cashews (kaju)': ('kg', 1000, 4000, 'est', 'snacks'),
    'Pistachios (pista)': ('kg', 1000, 6000, 'est', 'snacks'),
    'Pine nuts (chilgoza)': ('kg', 1000, 12000, 'est', 'snacks'),
    'Sesame seeds (til)': ('kg', 1000, 800, 'est', 'shelf'),
    'Flaxseed (alsi)': ('kg', 1000, 600, 'doc', 'shelf'),
    'Desiccated coconut (khopra)': ('kg', 1000, 1400, 'est', 'snacks'),
    'Black seed (kalonji)': ('kg', 1000, 900, 'doc', 'shelf'),
    # ---- oils and fats ----------------------------------------------------------------------------
    'Desi ghee': ('kg', 1000, 3400, 'doc', 'shelf'),
    'Banaspati ghee (vegetable shortening)': ('kg', 1000, 550, 'est', 'shelf'),
    'Sunflower oil': ('l', 920, 575, 'doc', 'shelf'),
    'Canola oil': ('l', 920, 575, 'doc', 'shelf'),
    'Olive oil': ('l', 920, 3600, 'doc', 'shelf'),
    'Soybean oil': ('l', 920, 560, 'est', 'shelf'),
    # ---- sweeteners -------------------------------------------------------------------------------
    'Sugar (cheeni)': ('kg', 1000, 250, 'doc', 'shelf'),
    'Honey (shehad)': ('kg', 1000, 2600, 'doc', 'snacks'),
    'Brown sugar (shakkar)': ('kg', 1000, 300, 'est', 'shelf'),
    # ---- spices (14 prices a monthly refill lot of PKR 900 for about 600 g; per kg below) -------------
    'Salt (namak)': ('kg', 1000, 60, 'doc', 'shelf'),
    'Turmeric (haldi)': ('kg', 1000, 900, 'est', 'shelf'),
    'Red chilli powder (lal mirch)': ('kg', 1000, 1200, 'est', 'shelf'),
    'Cumin seeds (zeera)': ('kg', 1000, 2200, 'est', 'shelf'),
    'Coriander seeds (dhaniya)': ('kg', 1000, 700, 'est', 'shelf'),
    'Black pepper (kali mirch)': ('kg', 1000, 3200, 'est', 'shelf'),
    'Cinnamon (darchini)': ('kg', 1000, 2000, 'est', 'shelf'),
    'Green cardamom (elaichi)': ('kg', 1000, 12000, 'est', 'shelf'),
    'Cloves (laung)': ('kg', 1000, 4500, 'est', 'shelf'),
    'Fennel seeds (saunf)': ('kg', 1000, 1000, 'est', 'shelf'),
    'Fenugreek seeds (methi dana)': ('kg', 1000, 500, 'est', 'shelf'),
    'Mustard seeds (rai)': ('kg', 1000, 600, 'est', 'shelf'),
    'Bay leaf (tez patta)': ('kg', 1000, 1000, 'est', 'shelf'),
    'Saffron (zafran)': ('g', 1, 1200, 'est', 'shelf'),
    # ---- beverages and condiments -----------------------------------------------------------------
    'Black tea, brewed (chai)': ('l', 1000, 25, 'est', 'shelf'),    # 14: tea leaves 2350/kg at about 10 g a litre
    'Green tea, brewed (sabz chai)': ('l', 1000, 25, 'est', 'shelf'),
    'Water': ('l', 1000, 13, 'est', 'shelf'),                        # 19 l refill bottle; most homes boil tap water
    'Vinegar (sirka)': ('bottle', 800, 220, 'doc', 'shelf'),
    'Tomato ketchup': ('pack', 800, 450, 'est', 'shelf'),
    'Tomato paste': ('pack', 400, 350, 'est', 'shelf'),
    'Soy sauce': ('bottle', 300, 300, 'est', 'shelf'),
    'Mayonnaise': ('pack', 500, 550, 'est', 'shelf'),
}

# city -> (region_code, multipliers by group) from 14 section 16.3
CITIES = {
    'Lahore': ('PB', None),
    'Karachi': ('SD', {'veg': 1.08, 'veg_sindh': 0.95, 'fruit': 1.05, 'banana': 0.90, 'apple': 1.05,
                       'meat': 1.05, 'sea_fish': 0.85, 'river_fish': 1.10, 'loose_dairy': 1.10,
                       'shelf': 1.02, 'snacks': 1.00}),
    'Islamabad': ('IS', {'veg': 1.10, 'veg_sindh': 1.10, 'fruit': 1.08, 'banana': 1.08, 'apple': 0.95,
                         'meat': 1.08, 'sea_fish': 1.15, 'river_fish': 1.15, 'loose_dairy': 1.12,
                         'shelf': 1.04, 'snacks': 0.98}),
}
LABELS = {
    'Lahore': 'Lahore retail Oct 2026 (seed, ops review pending)',
    'Karachi': 'Karachi retail Oct 2026, derived from Lahore (seed, ops review pending)',
    'Islamabad': 'Islamabad retail Oct 2026, derived from Lahore (seed, ops review pending)',
}
UNITS = {'g', 'kg', 'ml', 'l', 'piece', 'dozen', 'bunch', 'lot', 'bottle', 'pack'}


def ingredient_names():
    pat = re.compile(r"^  \('((?:[^']|'')*)', ")
    names = []
    with open(ING_SQL, encoding='utf-8') as fh:
        for line in fh:
            m = pat.match(line)
            if m:
                names.append(m.group(1).replace("''", "'"))
    if len(names) != 150:
        sys.exit(f'expected 150 ingredients in {ING_SQL}, found {len(names)}')
    return names


def q(s):
    return "'" + s.replace("'", "''") + "'"


def round5(x):
    return int((Decimal(str(x)) / 5).quantize(Decimal(1), rounding=ROUND_HALF_UP) * 5)


def city_price(city, name):
    """Lahore price times the city multiplier: nearest PKR 5 from PKR 100 up, nearest PKR 1 below."""
    unit, grams, pkr, basis, group = P[name]
    mult = CITIES[city][1]
    if mult is None:
        return pkr
    x = Decimal(str(pkr)) * Decimal(str(mult[group]))
    if x >= 100:
        return round5(x)
    return max(1, int(x.quantize(Decimal(1), rounding=ROUND_HALF_UP)))


PRICE_HEADER = """-- supabase/seed/catalog/080_price_books.sql
-- GENERATED by tooling/scripts/gen-price-seed.py; edit the table there and re-run (S4-03).
-- Price books for Lahore (PK/PB), Karachi (PK/SD) and Islamabad (PK/IS), effective 2026-10-01, one price
-- for every one of the 150 catalog ingredients per city (05 section 19 order 8, 14 section 16).
-- METHOD (full text in the script docstring): Lahore rows marked doc come from the 14 section 16.2
-- reference basket; rows marked est are estimates relative to it (not market observations). Karachi
-- and Islamabad are Lahore times the 14 section 16.3 category multipliers. Lahore: {n_doc} doc, {n_est} est.
-- Every observation is source 'seed', observed_on 2026-10-01, accepted, with explicit unit_grams.
-- REVIEW REQUIRED (ops): every est row, and all three books against market rate lists, before budgets are
-- trusted in the closed alpha; monthly review until user reports dominate (14 section 16.3).
-- Idempotent: profiles upsert on price_profiles_key, observations on price_observations_seed_key.
-- Ends by refreshing mv_ingredient_prices and mv_current_prices.
"""


def render_prices():
    names = ingredient_names()
    missing = [n for n in names if n not in P]
    extra = [n for n in P if n not in names]
    if missing or extra:
        sys.exit(f'price table out of sync with 040: missing {missing}, unknown {extra}')
    for n, (unit, grams, pkr, basis, group) in P.items():
        if unit not in UNITS or grams <= 0 or pkr <= 0 or basis not in ('doc', 'est'):
            sys.exit(f'bad price row {n}')
        for city, (_, mult) in CITIES.items():
            if mult is not None and group not in mult:
                sys.exit(f'no {city} multiplier for group {group} ({n})')
    n_doc = sum(1 for v in P.values() if v[3] == 'doc')
    out = [PRICE_HEADER.format(n_doc=n_doc, n_est=len(P) - n_doc)]
    out.append('insert into public.price_profiles (region_id, city, currency, effective_from, label)\n'
               'select r.id, v.city, \'PKR\', date ' + q(OBSERVED_ON) + ', v.label\nfrom (values\n')
    out.append(',\n'.join(f'  ({q(r)}, {q(c)}, {q(LABELS[c])})' for c, (r, _) in CITIES.items()))
    out.append('\n) v(region_code, city, label)\n'
               "join public.regions r on r.country_code = 'PK' and r.region_code = v.region_code\n"
               "on conflict (region_id, coalesce(city, ''), effective_from) do update set label = excluded.label;\n\n")
    for city, (region, _) in CITIES.items():
        out.append(f'-- {city}\n')
        out.append('insert into public.price_observations (price_profile_id, ingredient_id, unit, unit_grams, amount_minor,\n'
                   '                                      observed_on, source, moderation_status)\n'
                   "select p.id, i.id, v.unit, v.unit_grams, v.rupees * 100, date " + q(OBSERVED_ON) + ", 'seed', 'accepted'\n"
                   'from (values\n')
        rows = []
        for n in names:
            unit, grams, pkr, basis, group = P[n]
            rows.append(f'  ({q(n)}, {q(unit)}, {grams}, {city_price(city, n)})')
        out.append(',\n'.join(rows))
        out.append('\n) v(ingredient, unit, unit_grams, rupees)\n'
                   "join public.regions r on r.country_code = 'PK' and r.region_code = " + q(region) + '\n'
                   'join public.price_profiles p on p.region_id = r.id and p.city = ' + q(city)
                   + ' and p.effective_from = date ' + q(OBSERVED_ON) + '\n'
                   'join public.ingredients i on lower(i.name) = lower(v.ingredient)\n'
                   "on conflict (price_profile_id, ingredient_id, unit, observed_on) where source = 'seed'\n"
                   '  do update set amount_minor = excluded.amount_minor, unit_grams = excluded.unit_grams;\n\n')
    out.append('select public.refresh_ingredient_prices();\n')
    return ''.join(out)


# ---- seasonal produce for Sindh and ICT ---------------------------------------------------------------
INDEX = {'P': ('peak', '0.75'), 'A': ('available', '1.00'), 'S': ('scarce', '1.45')}
UP = {'S': 'A', 'A': 'P', 'P': 'P', '.': '.'}
WINTER = (10, 11, 0, 1)   # Nov, Dec, Jan, Feb (0-based)
LEAFY = ['Spinach (palak)', 'Mustard greens (sarson)', 'Coriander leaves (hara dhaniya)', 'Mint (podina)',
         'Lettuce (salad patta)', 'Spring onion (hara pyaz)']


def load_punjab():
    spec = importlib.util.spec_from_file_location('gen_recipe_seed', os.path.join(ROOT, 'tooling', 'scripts', 'gen-recipe-seed.py'))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return dict(mod.SEASON)


def sindh(pb):
    sd = {k: list(v) for k, v in pb.items()}
    for k in ('Banana', 'Papaya (papita)'):
        sd[k] = list('P' * 12)
    for k in ('Tomato', 'Onion'):
        for m in (9, 10, 11, 0):
            sd[k][m] = 'P'
    if 'Mango (aam)' in sd:
        for m in (4, 5, 6):
            sd['Mango (aam)'][m] = 'P'
    for m in (10, 11, 0, 1):
        sd['Guava (amrood)'][m] = 'A'
    for k in LEAFY:
        if k in sd:
            for m in WINTER:
                if sd[k][m] == 'P':
                    sd[k][m] = 'A'
    sea = ['P' if m in (8, 9, 10, 11, 0, 1, 2) else 'A' for m in range(12)]
    sd['Fish, surmai (king mackerel)'] = list(sea)
    sd['Prawns (jhinga)'] = list(sea)
    return {k: ''.join(v) for k, v in sd.items()}


def ict(pb):
    out = dict(pb)
    for k in ('Apple (saib)', 'Apricot (khubani)', 'Peach (aaru)'):
        if k in out:
            out[k] = ''.join(UP[c] for c in out[k])
    return out


SEASON_HEADER = """-- supabase/seed/catalog/096_seasonal_produce_sd_is.sql
-- GENERATED by tooling/scripts/gen-price-seed.py (S4-03); the Punjab calendar it starts from is SEASON in
-- tooling/scripts/gen-recipe-seed.py (095). Sindh (PK/SD, Karachi) applies the 14 section 15.3 overrides:
-- bananas and papaya peak all year; tomato and onion peak October to January; mango peak May to July;
-- guava available November to February; leafy greens one level lower November to February; surmai and
-- prawns available all year, peak September to March. ICT (PK/IS, Islamabad) is the Punjab table with
-- apples, apricots and peaches one level higher in their season. price_index uses the 14 section 15.4
-- defaults (peak 0.75, available 1.00, scarce 1.45) until prices-refresh recomputes it.
-- REVIEW REQUIRED: ops validates both calendars against Karachi and Islamabad market rate lists.
-- Idempotent: upsert on (region_id, ingredient_id, month) keeps admin edits (do nothing).
"""


def render_season():
    names = set(ingredient_names())
    pb = load_punjab()
    out = [SEASON_HEADER]
    for region, table in (('SD', sindh(pb)), ('IS', ict(pb))):
        rows = []
        for name, months in table.items():
            if name not in names:
                sys.exit(f'unknown ingredient {name!r} in seasonal table')
            for m, c in enumerate(months):
                if c == '.':
                    continue
                avail, idx = INDEX[c]
                rows.append(f'  ({q(name)}, {m + 1}, {q(avail)}, {idx})')
        out.append('insert into public.seasonal_produce (region_id, ingredient_id, month, availability, price_index)\n'
                   'select r.id, i.id, v.month, v.availability, v.price_index\nfrom (values\n')
        out.append(',\n'.join(rows))
        out.append('\n) v(ingredient, month, availability, price_index)\n'
                   "join public.regions r on r.country_code = 'PK' and r.region_code = " + q(region) + '\n'
                   'join public.ingredients i on lower(i.name) = lower(v.ingredient)\n'
                   'on conflict (region_id, ingredient_id, month) do nothing;\n\n')
    return ''.join(out).rstrip('\n') + '\n'


def main():
    files = {PRICE_SQL: render_prices(), SEASON_SQL: render_season()}
    if '--check' in sys.argv:
        stale = [p for p, body in files.items()
                 if not os.path.exists(p) or open(p, encoding='utf-8').read() != body]
        if stale:
            sys.exit('stale: ' + ', '.join(os.path.relpath(p, ROOT) for p in stale))
        return
    for path, body in files.items():
        with open(path, 'w', encoding='utf-8') as fh:
            fh.write(body)
        print(f'wrote {os.path.relpath(path, ROOT)}')


if __name__ == '__main__':
    main()
