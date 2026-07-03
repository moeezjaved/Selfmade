-- Brand slots per plan. A user's saved brands (the Clone/Script input foundation) are capped by
-- their plan — "basic gives you 3 brands", Atria-style. Enforced in POST /api/brands. -1 = unlimited.
ALTER TABLE plans ADD COLUMN IF NOT EXISTS brand_limit INT NOT NULL DEFAULT 1;

UPDATE plans SET brand_limit = 1  WHERE id = 'trial';
UPDATE plans SET brand_limit = 3  WHERE id = 'core';
UPDATE plans SET brand_limit = 10 WHERE id = 'plus';
UPDATE plans SET brand_limit = -1 WHERE id = 'business';   -- unlimited
