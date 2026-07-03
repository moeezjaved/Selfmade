-- Credit engine v2 — two-bucket (plan + top-up), plan-first spend, bucket-correct refunds
-- (pricing spec §2.2, §2.4, §2.5). Signatures are UNCHANGED so every existing caller keeps working;
-- user_profiles.credits_balance is maintained as a mirror of (plan+topup) for legacy readers.

-- Ensure a wallet exists for a user (new signups). Plan bucket seeded to the plan's monthly credits.
CREATE OR REPLACE FUNCTION ensure_wallet(p_user UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_credits INT; v_plan TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM credit_wallets WHERE owner_id = p_user) THEN RETURN; END IF;
  SELECT COALESCE(plan_id, 'free') INTO v_plan FROM user_profiles WHERE user_id = p_user;
  SELECT COALESCE(monthly_credits, 0) INTO v_credits FROM plans WHERE id = COALESCE(v_plan, 'free');
  INSERT INTO credit_wallets (owner_id, plan_credits_balance, topup_credits_balance, plan_credits_reset_at)
    VALUES (p_user, COALESCE(v_credits, 0), 0, date_trunc('day', now()) + INTERVAL '1 month')
    ON CONFLICT (owner_id) DO NOTHING;
END; $$;

-- Monthly reset: plan bucket → allotment (NO rollover); top-up untouched; expire top-ups > 12mo.
CREATE OR REPLACE FUNCTION ensure_monthly_reset(p_user UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_w credit_wallets; v_credits INT; v_plan TEXT; v_expired INT := 0;
BEGIN
  PERFORM ensure_wallet(p_user);
  SELECT * INTO v_w FROM credit_wallets WHERE owner_id = p_user FOR UPDATE;
  IF v_w IS NULL THEN RETURN; END IF;

  -- Expire top-up purchases past 12 months (FIFO rows) + reduce the bucket.
  SELECT COALESCE(SUM(credits_remaining), 0) INTO v_expired
    FROM topup_purchases WHERE owner_id = p_user AND credits_remaining > 0 AND expires_at <= now();
  IF v_expired > 0 THEN
    UPDATE topup_purchases SET credits_remaining = 0
      WHERE owner_id = p_user AND credits_remaining > 0 AND expires_at <= now();
    UPDATE credit_wallets SET topup_credits_balance = GREATEST(0, topup_credits_balance - v_expired)
      WHERE owner_id = p_user;
    INSERT INTO credit_transactions (user_id, action_type, delta, balance_after, status, bucket)
      VALUES (p_user, 'expire', -v_expired,
              (SELECT plan_credits_balance + topup_credits_balance FROM credit_wallets WHERE owner_id = p_user),
              'committed', 'topup');
  END IF;

  IF v_w.plan_credits_reset_at IS NOT NULL AND now() >= v_w.plan_credits_reset_at THEN
    SELECT COALESCE(plan_id, 'free') INTO v_plan FROM user_profiles WHERE user_id = p_user;
    SELECT COALESCE(monthly_credits, 0) INTO v_credits FROM plans WHERE id = COALESCE(v_plan, 'free');
    v_credits := COALESCE((SELECT monthly_credits_override FROM subscriptions WHERE owner_id = p_user), v_credits, 0);
    UPDATE credit_wallets
      SET plan_credits_balance = v_credits,
          plan_credits_reset_at = date_trunc('day', now()) + INTERVAL '1 month'
      WHERE owner_id = p_user;
    INSERT INTO credit_transactions (user_id, action_type, delta, balance_after, status, bucket)
      VALUES (p_user, 'plan_grant', v_credits,
              v_credits + (SELECT topup_credits_balance FROM credit_wallets WHERE owner_id = p_user),
              'committed', 'plan');
  END IF;

  -- Mirror total onto user_profiles.credits_balance for legacy readers.
  UPDATE user_profiles up
    SET credits_balance = w.plan_credits_balance + w.topup_credits_balance,
        credits_reset_at = w.plan_credits_reset_at
    FROM credit_wallets w WHERE w.owner_id = p_user AND up.user_id = p_user;
END; $$;

-- Reserve: plan-first, then top-up. Locks the wallet row → no double-spend. Records the bucket split
-- in metadata so refund returns credits to the exact buckets they came from.
CREATE OR REPLACE FUNCTION reserve_credits(p_user UUID, p_action TEXT, p_ref TEXT DEFAULT NULL)
RETURNS credit_transactions LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_price INT; v_w credit_wallets; v_total INT; v_plan_spent INT; v_topup_spent INT;
        v_after INT; v_tx credit_transactions; v_bucket TEXT;
BEGIN
  PERFORM ensure_monthly_reset(p_user);
  SELECT credits INTO v_price FROM credit_pricing WHERE action_type = p_action AND is_active = TRUE;
  IF v_price IS NULL THEN RAISE EXCEPTION 'unknown_action:%', p_action USING ERRCODE='P0001'; END IF;

  SELECT * INTO v_w FROM credit_wallets WHERE owner_id = p_user FOR UPDATE;
  IF v_w IS NULL THEN RAISE EXCEPTION 'no_wallet' USING ERRCODE='P0001'; END IF;
  v_total := v_w.plan_credits_balance + v_w.topup_credits_balance;
  IF v_total < v_price THEN
    RAISE EXCEPTION 'insufficient_credits:need=%,have=%', v_price, v_total USING ERRCODE='P0002';
  END IF;

  v_plan_spent  := LEAST(v_price, v_w.plan_credits_balance);
  v_topup_spent := v_price - v_plan_spent;
  v_after := v_total - v_price;
  v_bucket := CASE WHEN v_plan_spent > 0 AND v_topup_spent > 0 THEN 'plan+topup'
                   WHEN v_topup_spent > 0 THEN 'topup' ELSE 'plan' END;

  UPDATE credit_wallets
    SET plan_credits_balance = plan_credits_balance - v_plan_spent,
        topup_credits_balance = topup_credits_balance - v_topup_spent,
        updated_at = now()
    WHERE owner_id = p_user;
  UPDATE user_profiles SET credits_balance = v_after WHERE user_id = p_user;

  -- Consume top-up purchases FIFO for the top-up portion (keeps expiry accounting honest).
  IF v_topup_spent > 0 THEN
    DECLARE v_left INT := v_topup_spent; r RECORD;
    BEGIN
      FOR r IN SELECT id, credits_remaining FROM topup_purchases
               WHERE owner_id = p_user AND credits_remaining > 0 ORDER BY expires_at ASC LOOP
        EXIT WHEN v_left <= 0;
        UPDATE topup_purchases SET credits_remaining = credits_remaining - LEAST(v_left, r.credits_remaining) WHERE id = r.id;
        v_left := v_left - LEAST(v_left, r.credits_remaining);
      END LOOP;
    END;
  END IF;

  INSERT INTO credit_transactions (user_id, action_type, delta, balance_after, status, reference_id, bucket, metadata)
    VALUES (p_user, p_action, -v_price, v_after, 'reserved', p_ref, v_bucket,
            jsonb_build_object('plan_spent', v_plan_spent, 'topup_spent', v_topup_spent))
    RETURNING * INTO v_tx;
  RETURN v_tx;
END; $$;

CREATE OR REPLACE FUNCTION commit_credits(p_tx UUID, p_metadata JSONB DEFAULT '{}')
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE credit_transactions
    SET status='committed', metadata = COALESCE(metadata, '{}'::jsonb) || COALESCE(p_metadata, '{}'::jsonb)
    WHERE id = p_tx AND status = 'reserved';
END; $$;

-- Refund → return credits to the SAME buckets they were taken from (spec §2.4). Idempotent.
CREATE OR REPLACE FUNCTION refund_credits(p_tx UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_tx credit_transactions; v_plan INT; v_topup INT; v_after INT;
BEGIN
  SELECT * INTO v_tx FROM credit_transactions WHERE id = p_tx FOR UPDATE;
  IF v_tx IS NULL OR v_tx.status <> 'reserved' THEN RETURN; END IF;
  v_plan  := COALESCE((v_tx.metadata->>'plan_spent')::INT, 0);
  v_topup := COALESCE((v_tx.metadata->>'topup_spent')::INT, (-v_tx.delta));  -- fallback: all to topup
  IF (v_plan + v_topup) <> (-v_tx.delta) THEN v_plan := -v_tx.delta; v_topup := 0; END IF;

  UPDATE credit_wallets
    SET plan_credits_balance = plan_credits_balance + v_plan,
        topup_credits_balance = topup_credits_balance + v_topup, updated_at = now()
    WHERE owner_id = v_tx.user_id;
  SELECT plan_credits_balance + topup_credits_balance INTO v_after FROM credit_wallets WHERE owner_id = v_tx.user_id;
  UPDATE user_profiles SET credits_balance = v_after WHERE user_id = v_tx.user_id;

  UPDATE credit_transactions SET status='refunded' WHERE id = p_tx;
  INSERT INTO credit_transactions (user_id, action_type, delta, balance_after, status, reference_id, bucket)
    VALUES (v_tx.user_id, 'refund', -v_tx.delta, v_after, 'committed', p_tx::text, v_tx.bucket);
END; $$;

-- Grant credits into the TOP-UP bucket (welcome bonus + generic). Rolls over.
CREATE OR REPLACE FUNCTION grant_credits(p_user UUID, p_credits INT, p_ref TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_after INT;
BEGIN
  PERFORM ensure_wallet(p_user);
  UPDATE credit_wallets SET topup_credits_balance = topup_credits_balance + p_credits, updated_at = now()
    WHERE owner_id = p_user;
  SELECT plan_credits_balance + topup_credits_balance INTO v_after FROM credit_wallets WHERE owner_id = p_user;
  UPDATE user_profiles SET credits_balance = v_after WHERE user_id = p_user;
  INSERT INTO credit_transactions (user_id, action_type, delta, balance_after, status, reference_id, bucket)
    VALUES (p_user, 'topup', p_credits, v_after, 'committed', p_ref, 'topup');
END; $$;

-- Grant a purchased top-up PACK: credits into the bucket + a FIFO purchase row (12-month expiry).
CREATE OR REPLACE FUNCTION grant_topup_pack(p_user UUID, p_credits INT, p_amount NUMERIC, p_stripe TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  PERFORM ensure_wallet(p_user);
  INSERT INTO topup_purchases (owner_id, credits, credits_remaining, amount_usd, stripe_payment_id, expires_at)
    VALUES (p_user, p_credits, p_credits, p_amount, p_stripe, now() + INTERVAL '12 months');
  PERFORM grant_credits(p_user, p_credits, COALESCE(p_stripe, 'topup_pack'));
END; $$;
