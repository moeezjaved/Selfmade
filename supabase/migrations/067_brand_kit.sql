-- Brand Kit — the colors + fonts we auto-detect from a brand's site, stored so users can review/edit
-- them and every generated ad stays on-brand. Shape: { colors: ["#..",..], fonts: { heading, body } }.
ALTER TABLE brands ADD COLUMN IF NOT EXISTS brand_kit JSONB NOT NULL DEFAULT '{}'::jsonb;
