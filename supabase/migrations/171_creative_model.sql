-- Record the ACTUAL image model that generated each creative. Until now creative_generations stored
-- only `tier` ('pro'/'default') — a BILLING label, hardcoded at the call site — so there was no way to
-- verify which model really ran (e.g. was an "inspired" ad truly made by gemini-3-pro-image, or did a
-- past flash-default regression quietly use flash?). This column is written with gen.model going forward.
ALTER TABLE creative_generations ADD COLUMN IF NOT EXISTS model text;
