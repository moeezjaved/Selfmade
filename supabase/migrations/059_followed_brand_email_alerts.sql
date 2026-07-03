-- Per-brand email alerts (opt-in, 2 credits each). A user chooses email alerts PER followed brand —
-- e.g. from the Brand Spy view when they spy a brand — instead of a single global toggle. The
-- alert-worker emails only for brands where this is true. Default OFF (opt-in).
alter table followed_brands add column if not exists email_alerts boolean not null default false;
