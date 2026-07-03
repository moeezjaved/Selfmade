-- creative_generations was created without grants to the Supabase API roles (leftover from the
-- us-east migration where default privileges weren't fully restored) → "permission denied for table".
-- Grant the standard roles so the service-role insert (and RLS-scoped authenticated reads) work.
GRANT ALL ON TABLE public.creative_generations TO anon, authenticated, service_role;
