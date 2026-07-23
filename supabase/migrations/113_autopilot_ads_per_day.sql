-- 113_autopilot_ads_per_day.sql — let the founder choose how many ads Mello makes per day.
-- The autopilot was 1 ad/day/enrollment, uncapped. Now the user picks a daily volume (shown with its
-- credit cost + gated on balance in the UI); the autopilot worker reads this to make N/day. Additive.
alter table ad_autopilot add column if not exists ads_per_day int not null default 1;
alter table ad_autopilot add constraint ad_autopilot_ads_per_day_ck check (ads_per_day between 1 and 10) not valid;
