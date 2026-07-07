-- 090: Enable RLS on public tables the Security Advisor flagged as exposed.
--
-- BEFORE: these tables had RLS OFF with grants to anon/authenticated. Because the
-- anon key ships in the browser, anyone could read/write credit_wallets, subscriptions,
-- and topup_purchases via the PostgREST API (mint credits, flip plans). The rest leaked
-- cross-tenant to any logged-in user.
--
-- SAFE because ALL app access to these tables is server-side via the service_role client,
-- and service_role has rolbypassrls=t → RLS-on with no policy denies anon/authenticated
-- while service_role continues to work. No feature depends on client-side access to them.
--
-- Applied live to production (project pliunbowobhmnwevqwrx) 2026-07-08 via SQL Editor;
-- this file records it for version control. Reversible: ALTER TABLE ... DISABLE ROW LEVEL SECURITY.

ALTER TABLE public.credit_wallets         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.topup_purchases        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assets                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mello_memory           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_member_ad_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saved_ad_tags          ENABLE ROW LEVEL SECURITY;

-- Belt & suspenders on the money tables: remove the grants entirely so exposure can't
-- reappear if RLS is ever toggled off. service_role is unaffected (it owns/bypasses).
REVOKE ALL ON public.credit_wallets, public.subscriptions, public.topup_purchases FROM anon, authenticated;

-- 8th advisor error: active_workers was a SECURITY DEFINER view (ran with the creator's
-- rights, bypassing the caller's RLS on worker_heartbeats). It's an unused monitoring view
-- (no app/worker references) — flip to security_invoker so it respects the caller's RLS.
ALTER VIEW public.active_workers SET (security_invoker = on);
