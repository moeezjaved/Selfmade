-- Apply a plan change (upgrade/downgrade) atomically: set plan_id, refill the plan credit bucket to
-- the new tier's allotment, renew the reset date, mirror the total. Called by the Stripe webhook on
-- subscription create/update (spec §5 — upgrade grants the new allotment immediately).
CREATE OR REPLACE FUNCTION apply_plan(p_user UUID, p_plan TEXT, p_reset TIMESTAMPTZ DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_credits INT; v_after INT; v_reset TIMESTAMPTZ;
BEGIN
  PERFORM ensure_wallet(p_user);
  SELECT COALESCE(monthly_credits, 0) INTO v_credits FROM plans WHERE id = p_plan;
  v_credits := COALESCE((SELECT monthly_credits_override FROM subscriptions WHERE owner_id = p_user), v_credits, 0);
  v_reset := COALESCE(p_reset, date_trunc('day', now()) + INTERVAL '1 month');

  UPDATE user_profiles SET plan_id = p_plan WHERE user_id = p_user;
  UPDATE credit_wallets SET plan_credits_balance = v_credits, plan_credits_reset_at = v_reset, updated_at = now()
    WHERE owner_id = p_user;
  SELECT plan_credits_balance + topup_credits_balance INTO v_after FROM credit_wallets WHERE owner_id = p_user;
  UPDATE user_profiles SET credits_balance = v_after, credits_reset_at = v_reset WHERE user_id = p_user;

  INSERT INTO credit_transactions (user_id, action_type, delta, balance_after, status, bucket, reference_id)
    VALUES (p_user, 'plan_grant', v_credits, v_after, 'committed', 'plan', p_plan);
END; $$;

-- Bulk monthly reset for the cron (spec §2.5) — applies any due resets/expiries across all wallets.
CREATE OR REPLACE FUNCTION run_due_resets()
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE r RECORD; n INT := 0;
BEGIN
  FOR r IN SELECT owner_id FROM credit_wallets
           WHERE (plan_credits_reset_at IS NOT NULL AND now() >= plan_credits_reset_at)
              OR EXISTS (SELECT 1 FROM topup_purchases t WHERE t.owner_id = credit_wallets.owner_id AND t.credits_remaining > 0 AND t.expires_at <= now())
  LOOP
    PERFORM ensure_monthly_reset(r.owner_id);
    n := n + 1;
  END LOOP;
  RETURN n;
END; $$;
