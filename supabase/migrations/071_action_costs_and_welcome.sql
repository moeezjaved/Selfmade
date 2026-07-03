-- Action costs (pricing spec §2.3) + one-time Free welcome bonus (§2.5.1).

INSERT INTO credit_pricing (action_type, label, credits, is_active) VALUES
  ('transcribe',       'Transcribe an ad',            2,  true),
  ('script_generate',  'AI script',                   5,  true),
  ('script_duplicate', 'Duplicate script',            5,  true),
  ('brand_analysis',   'URL / brand analyze',         3,  true),
  ('review_mining',    'Review mining',               3,  true),
  ('ask_mello',        'Ask Mello (per message)',     1,  true),
  ('image_clone_pro',  'AI ad clone (2K, Nano Banana Pro)', 15, true),
  ('image_clone_4k',   'AI ad clone (4K / HD)',       25, true),
  ('image_edit_pro',   'AI ad edit',                  10, true),
  ('video_clone',      'Video clone (AI clip)',       40, true)
ON CONFLICT (action_type) DO UPDATE SET label = excluded.label, credits = excluded.credits, is_active = true;

-- Rebuild ensure_wallet to also drop the one-time Free welcome bonus (60cr) into the top-up bucket on
-- first wallet creation — so a brand-new user can test ~1 image (15) + 1 video (40) before the 20/mo cap.
CREATE OR REPLACE FUNCTION ensure_wallet(p_user UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_credits INT; v_plan TEXT; v_welcome INT := 60; v_after INT;
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
