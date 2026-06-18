-- Per-ad list of countries the ad actually targeted (from Meta's
-- ad_reached_countries field). One ad can target multiple countries.
-- Filter via: WHERE 'US' = ANY(targeted_countries)

alter table discovery_ads_index
  add column if not exists targeted_countries text[];

-- GIN index for efficient array containment queries
create index if not exists discovery_ads_targeted_countries_idx
  on discovery_ads_index using gin (targeted_countries);

comment on column discovery_ads_index.targeted_countries is
  'Countries this ad targeted, from Meta ad_reached_countries. One ad can target many.';
