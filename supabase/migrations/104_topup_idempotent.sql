-- Make top-up fulfilment idempotent. Stripe delivers a webhook event AT LEAST once — it can (and does)
-- send the same event more than once, and manual resends re-run it too. Without a guard, each delivery
-- of the same payment grants the pack again → the customer is double-credited. Guard on stripe_payment_id.
CREATE OR REPLACE FUNCTION grant_topup_pack(p_user UUID, p_credits INT, p_amount NUMERIC, p_stripe TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Already fulfilled this exact payment? Do nothing — never double-grant.
  IF p_stripe IS NOT NULL AND EXISTS (SELECT 1 FROM topup_purchases WHERE stripe_payment_id = p_stripe) THEN
    RETURN;
  END IF;
  PERFORM ensure_wallet(p_user);
  INSERT INTO topup_purchases (owner_id, credits, credits_remaining, amount_usd, stripe_payment_id, expires_at)
    VALUES (p_user, p_credits, p_credits, p_amount, p_stripe, now() + INTERVAL '12 months');
  PERFORM grant_credits(p_user, p_credits, COALESCE(p_stripe, 'topup_pack'));
END; $$;
