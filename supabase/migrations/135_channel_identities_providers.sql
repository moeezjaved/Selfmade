-- channel_identities.provider was locked to ('slack','whatsapp') by a CHECK constraint from mig 131.
-- The Customer Employee connects many more channels via Unipile (Instagram, Messenger, Telegram,
-- LinkedIn, X, email) + the founder's calendar — every bind for those was being REJECTED by the DB
-- (which is why connected channels never showed ✓). Widen the whitelist.
-- Small constraint swap; apply during a quiet window (pause crawl/drain) per the pause-before-DDL rule.
alter table public.channel_identities drop constraint if exists channel_identities_provider_check;
alter table public.channel_identities add constraint channel_identities_provider_check
  check (provider in ('slack','whatsapp','instagram','messenger','telegram','linkedin','x','email','calendar'));
