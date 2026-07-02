-- Unique AI-written copy per brand for the /brands/[slug] SEO pages. Templated copy across 1000s of
-- pages reads as "doorway/duplicate" content to Google; a distinct intro + meta description per brand
-- makes each page genuinely unique. Generated once by seo-content-worker.mjs (gpt-4o-mini), stored
-- here, read by the page (falls back to the template if a brand has no row yet).
--
-- Isolated new table (no ALTER on a hot table) → safe to apply alongside the drain.
create table if not exists brand_seo_content (
  page_id          text primary key,
  brand_name       text,
  headline         text,          -- optional unique H1 variant
  intro_md         text,          -- 2-4 sentence unique intro (the anti-duplicate-content copy)
  meta_description text,          -- unique <meta name=description>
  faq              jsonb,         -- optional [{q,a}] for FAQ schema later
  model            text,
  generated_at     timestamptz default now()
);

alter table brand_seo_content enable row level security;
grant select, insert, update, delete on brand_seo_content to service_role;

-- Index for "which brands still need content generated" scans by the worker.
create index if not exists brand_seo_content_generated_idx on brand_seo_content (generated_at);
