-- Sales Assistant: count how many follow-ups Mello has drafted for a thread, so a buying-intent chat that
-- went quiet gets a nudge (drafted for approval) at most once or twice — never an endless loop. Additive.
alter table public.customer_threads add column if not exists followups int not null default 0;
