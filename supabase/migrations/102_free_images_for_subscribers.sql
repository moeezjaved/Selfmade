-- Pricing v2 (2026-07-17): image-ad remakes are FREE + unlimited for SUBSCRIBERS (Creator/Agency, and
-- legacy Pro/Enterprise). The free-image rule MUST live in reserve_credits itself — the app has callers
-- that hit the RPC directly (e.g. /api/discovery/clone-image) and would otherwise bypass any app-layer
-- check, so a subscriber would get wrongly charged and "Unlimited image ads" would be false.
--
-- For a subscriber + image action we record a 0-credit COMMITTED tx and return it — no deduction, no
-- insufficient-credits check. The reserve→commit/refund contract still holds for every caller:
-- commit_credits no-ops (already committed), refund_credits no-ops (not 'reserved').
--
-- This is a signature-preserving CREATE OR REPLACE (no schema/table change). Body is the current live
-- function verbatim plus the guard block, so all existing behavior (wallets, org pool, topup FIFO) is intact.

CREATE OR REPLACE FUNCTION public.reserve_credits(p_user uuid, p_action text, p_ref text DEFAULT NULL::text)
RETURNS credit_transactions LANGUAGE plpgsql SECURITY DEFINER AS $function$
DECLARE v_price INT; v_w credit_wallets; v_total INT; v_plan_spent INT; v_topup_spent INT;
        v_after INT; v_tx credit_transactions; v_bucket TEXT; v_owner uuid; v_actor uuid := p_user;
        v_plan TEXT;
BEGIN
  -- Team members draw from the org's shared pool → resolve to the billing owner.
  SELECT o.owner_id INTO v_owner
  FROM org_members m JOIN organizations o ON o.id = m.org_id
  WHERE m.user_id = p_user ORDER BY m.created_at DESC LIMIT 1;
  IF v_owner IS NOT NULL THEN p_user := v_owner; END IF;

  PERFORM ensure_monthly_reset(p_user);
  SELECT credits INTO v_price FROM credit_pricing WHERE action_type = p_action AND is_active = TRUE;
  IF v_price IS NULL THEN RAISE EXCEPTION 'unknown_action:%', p_action USING ERRCODE='P0001'; END IF;

  -- ── Pricing v2: FREE unlimited image remakes for subscribers ──
  IF p_action IN ('image_clone_pro','image_clone_4k','image_edit_pro') THEN
    SELECT plan_id INTO v_plan FROM user_profiles WHERE user_id = p_user;
    IF v_plan IN ('starter','pro','business','enterprise') THEN
      SELECT plan_credits_balance + topup_credits_balance INTO v_total FROM credit_wallets WHERE owner_id = p_user;
      INSERT INTO credit_transactions (user_id, action_type, delta, balance_after, status, reference_id, bucket, metadata)
        VALUES (p_user, p_action, 0, COALESCE(v_total, 0), 'committed', p_ref, 'free',
                jsonb_build_object('free_for_subscriber', true, 'plan', v_plan, 'spent_by', v_actor))
        RETURNING * INTO v_tx;
      RETURN v_tx;
    END IF;
  END IF;

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
            jsonb_build_object('plan_spent', v_plan_spent, 'topup_spent', v_topup_spent, 'spent_by', v_actor))
    RETURNING * INTO v_tx;
  RETURN v_tx;
END; $function$;
