-- Welcome bonus 60 → 500 (1-credit-=-1¢ redenomination, migration 095). ensure_wallet hardcoded the
-- pre-redenomination 60cr, so a new Free signup got 160cr total — one image clone, while onboarding
-- promises ~5. 500 welcome + 100/mo = 600cr ≈ 5-6 image clones (100cr each), video (650) stays just
-- behind the $9 Launch Pack. Same function as 071, only v_welcome changes.
CREATE OR REPLACE FUNCTION ensure_wallet(p_user UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_credits INT; v_plan TEXT; v_welcome INT := 500; v_after INT;
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
