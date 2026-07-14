-- Credit re-denomination: 1 credit = $0.01 (1 cent), everywhere. Video repriced to cost-plus (2× fal
-- cost) as an acquisition loss-leader; captions added as a high-margin blade; every other action and
-- all existing balances scaled ×6.5 so their real dollar value is preserved (was ~6.5¢/credit at the
-- topup rate). Data-only (DML) — no schema change, safe under load. Runtime source of truth for
-- reserve_credits() is credit_pricing; ensure_wallet() reads plans.monthly_credits.
BEGIN;

-- ── VIDEO — 2× measured fal cost ($0.21/s premium, ~$0.09/s fast; 15s-clip basis) ──
UPDATE credit_pricing SET credits=650,  est_cost_usd=3.15  WHERE action_type='video_clone';
UPDATE credit_pricing SET credits=300,  est_cost_usd=1.35  WHERE action_type='video_clone_fast';
UPDATE credit_pricing SET credits=1300, est_cost_usd=6.30  WHERE action_type='video_clone_x2';
UPDATE credit_pricing SET credits=1900, est_cost_usd=9.45  WHERE action_type='video_clone_x3';
UPDATE credit_pricing SET credits=2500, est_cost_usd=12.60 WHERE action_type='video_clone_x4';
UPDATE credit_pricing SET credits=550,  est_cost_usd=2.70  WHERE action_type='video_clone_x2_fast';
UPDATE credit_pricing SET credits=800,  est_cost_usd=4.05  WHERE action_type='video_clone_x3_fast';
UPDATE credit_pricing SET credits=1100, est_cost_usd=5.40  WHERE action_type='video_clone_x4_fast';

-- ── CAPTIONS — TikTok-style burned captions (Whisper ~$0.01 + ffmpeg free) ──
INSERT INTO credit_pricing (action_type, label, credits, est_cost_usd, is_active)
  VALUES ('video_captions','TikTok-style burned captions',250,0.01,true)
  ON CONFLICT (action_type) DO UPDATE SET credits=EXCLUDED.credits, label=EXCLUDED.label, est_cost_usd=EXCLUDED.est_cost_usd, is_active=true;

-- ── EVERYTHING ELSE — ×6.5 (preserve dollar price at the 1¢ basis) ──
UPDATE credit_pricing SET credits=100  WHERE action_type='animate_motion';
UPDATE credit_pricing SET credits=160  WHERE action_type='animate_motion_4k';
UPDATE credit_pricing SET credits=10   WHERE action_type='ask_mello';
UPDATE credit_pricing SET credits=10   WHERE action_type='asset_ai_tag';
UPDATE credit_pricing SET credits=20   WHERE action_type='brand_analysis';
UPDATE credit_pricing SET credits=1000 WHERE action_type='brand_spy';
UPDATE credit_pricing SET credits=15   WHERE action_type='email_alert';
UPDATE credit_pricing SET credits=15   WHERE action_type='email_digest';
UPDATE credit_pricing SET credits=170  WHERE action_type='image_clone';
UPDATE credit_pricing SET credits=160  WHERE action_type='image_clone_4k';
UPDATE credit_pricing SET credits=100  WHERE action_type='image_clone_pro';
UPDATE credit_pricing SET credits=15   WHERE action_type='image_edit';
UPDATE credit_pricing SET credits=65   WHERE action_type='image_edit_pro';
UPDATE credit_pricing SET credits=160  WHERE action_type='image_studio_4k';
UPDATE credit_pricing SET credits=100  WHERE action_type='image_studio_pro';
UPDATE credit_pricing SET credits=20   WHERE action_type='review_mining';
UPDATE credit_pricing SET credits=35   WHERE action_type='script_duplicate';
UPDATE credit_pricing SET credits=35   WHERE action_type='script_generate';
UPDATE credit_pricing SET credits=15   WHERE action_type='transcribe';

-- ── PLAN monthly allowances (bundled perk, worth ~40-60% of the sub price) ──
UPDATE plans SET monthly_credits=100   WHERE id='free';
UPDATE plans SET monthly_credits=2000  WHERE id='starter';
UPDATE plans SET monthly_credits=5000  WHERE id='pro';
UPDATE plans SET monthly_credits=15000 WHERE id='business';
UPDATE plans SET monthly_credits=500   WHERE id='trial';   -- legacy → free-ish
UPDATE plans SET monthly_credits=2000  WHERE id='core';    -- legacy → starter
UPDATE plans SET monthly_credits=5000  WHERE id='plus';    -- legacy → pro

-- ── EXISTING BALANCES ×6.5 (preserve real value; 8 funded wallets, all test) ──
UPDATE credit_wallets SET plan_credits_balance=ROUND(plan_credits_balance*6.5)::int,
                          topup_credits_balance=ROUND(topup_credits_balance*6.5)::int, updated_at=now();
UPDATE topup_purchases SET credits_remaining=ROUND(credits_remaining*6.5)::int WHERE credits_remaining>0;
UPDATE user_profiles SET credits_balance=ROUND(credits_balance*6.5)::int WHERE credits_balance IS NOT NULL AND credits_balance>0;

COMMIT;
