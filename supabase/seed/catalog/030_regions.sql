-- supabase/seed/catalog/030_regions.sql
-- 05 section 19 order 3: MVP regions (ISO 3166-2:PK subdivision suffixes). regions has no city
-- column; the pilot cities map as Punjab -> Lahore, Sindh -> Karachi, ICT -> Islamabad
-- (households.city). Climate zones per 05: Punjab hot_semi_arid, Sindh hot_arid, ICT
-- humid_subtropical; Khyber Pakhtunkhwa (Peshawar) hot_semi_arid. Phase 2 regions are not seeded
-- yet. Idempotent upsert on (country_code, region_code).
insert into public.regions (country_code, region_code, name, climate_zone, default_currency) values
  ('PK', 'PB', 'Punjab',                     'hot_semi_arid',     'PKR'),
  ('PK', 'SD', 'Sindh',                      'hot_arid',          'PKR'),
  ('PK', 'IS', 'Islamabad Capital Territory', 'humid_subtropical', 'PKR'),
  ('PK', 'KP', 'Khyber Pakhtunkhwa',         'hot_semi_arid',     'PKR')
on conflict (country_code, region_code) do update
  set name = excluded.name, climate_zone = excluded.climate_zone, default_currency = excluded.default_currency;
