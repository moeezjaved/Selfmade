-- Asset video-AI clip filters (Atria parity): Scene / Caption / Audio / A-B-roll.
-- Filled by the Gemini video-analysis pass in the enrich job; drive the Assets filter dropdowns.
alter table assets add column if not exists has_captions boolean;              -- on-screen text present
alter table assets add column if not exists audio_kind text;                   -- voiceover | music | silent
alter table assets add column if not exists scene text;                        -- unboxing | talking_head | lifestyle | product_demo | other
alter table assets add column if not exists roll text;                         -- a_roll | b_roll
create index if not exists idx_assets_clip on assets (org_id, scene, audio_kind, roll);

-- Credit price for AI tagging (Atria charges 1 credit/asset). 1 credit ≫ the few-tenths-of-a-cent
-- Gemini cost → well past 100% profit. reserve_credits reads this table at runtime.
insert into credit_pricing (action_type, label, credits, is_active)
values ('asset_ai_tag', 'Asset AI tagging', 1, true)
on conflict (action_type) do update set credits = excluded.credits, label = excluded.label, is_active = true;
