-- New free-tier media model: a Free account gets a ONE-TIME 75-credit trial (5 image ads @ 15 cr),
-- then must upgrade. No monthly refill, and (enforced app-side by canBuyCredits=false) Free cannot
-- buy top-ups. When the 75 run out, generating media prompts an upgrade to a paid plan.
--
-- Two levers:
--   1. plans.monthly_credits(free) = 0 → the monthly plan-grant refill (reserve_credits reset branch,
--      mig 070) tops the plan bucket to 0, so there is no recurring free allowance.
--   2. ensure_wallet welcome bonus 500 → 75 → a NEW free signup gets exactly 75 topup credits, once.
-- Existing free wallets are untouched (ensure_wallet no-ops when a wallet exists); they simply stop
-- getting monthly refills from lever 1 and upgrade once spent — the model applies to everyone.

UPDATE plans SET monthly_credits = 0 WHERE id = 'free';

CREATE OR REPLACE FUNCTION ensure_wallet(p_user UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_credits INT; v_plan TEXT; v_welcome INT := 75; v_after INT;
BEGIN
  IF EXISTS (SELECT 1 FROM credit_wallets WHERE owner_id = p_user) THEN RETURN; END IF;
  SELECT COALESCE(plan_id, 'free') INTO v_plan FROM user_profiles WHERE user_id = p_user;
  SELECT COALESCE(monthly_credits, 0) INTO v_credits FROM plans WHERE id = COALESCE(v_plan, 'free');
  INSERT INTO credit_wallets (owner_id, plan_credits_balance, topup_credits_balance, plan_credits_reset_at)
    VALUES (p_user, COALESCE(v_credits, 0),
            CASE WHEN COALESCE(v_plan,'free') = 'free' THEN v_welcome ELSE 0 END,
            date_trunc('day', now()) + INTERVAL '1 month')
    ON CONFLICT (owner_id) DO NOTHING;
  IF COALESCE(v_plan,'free') = 'free' THEN
    v_after := COALESCE(v_credits,0) + v_welcome;
    UPDATE user_profiles SET credits_balance = v_after WHERE user_id = p_user;
    INSERT INTO credit_transactions (user_id, action_type, delta, balance_after, status, bucket)
      VALUES (p_user, 'welcome', v_welcome, v_after, 'committed', 'topup');
  END IF;
END; $$;
