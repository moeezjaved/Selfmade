-- Login history for the admin per-user view. Supabase records every auth event in
-- auth.audit_log_entries, but the `auth` schema isn't exposed through PostgREST, so the admin client
-- can't read it directly. This SECURITY DEFINER function (service_role only) counts real sign-ins in
-- the last 7 / 30 days + all-time, and returns the most recent login timestamps — so the founder can
-- see how active each user is, not just their last session.
--
-- Only 'login' events are counted (a real sign-in); token_refreshed / logout are ignored.

CREATE OR REPLACE FUNCTION admin_login_stats(p_user UUID)
RETURNS JSONB LANGUAGE sql SECURITY DEFINER SET search_path = auth, public AS $$
  WITH logins AS (
    SELECT created_at
    FROM auth.audit_log_entries
    WHERE (payload->>'actor_id')::uuid = p_user
      AND payload->>'action' = 'login'
  )
  SELECT jsonb_build_object(
    'd7',    (SELECT count(*) FROM logins WHERE created_at > now() - interval '7 days'),
    'd30',   (SELECT count(*) FROM logins WHERE created_at > now() - interval '30 days'),
    'total', (SELECT count(*) FROM logins),
    'recent',(SELECT COALESCE(jsonb_agg(created_at ORDER BY created_at DESC), '[]'::jsonb)
              FROM (SELECT created_at FROM logins ORDER BY created_at DESC LIMIT 20) r)
  );
$$;

REVOKE ALL ON FUNCTION admin_login_stats(UUID) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_login_stats(UUID) TO service_role;
