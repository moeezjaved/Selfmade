-- Page Builder — persisted built pages (drafts + published).
-- See docs/superpowers/specs/2026-09-03-page-builder-design.md.
-- `content` (jsonb) is the source of truth a page re-renders from; preview_html is a cached snapshot.
-- Templates live in code, not here. App access is via the service_role (admin) client, so RLS is on
-- with no policies (deny-by-default for anon/auth), matching geo_assets.
-- NOTE (standing rule): pause the crawl / drain writes before applying this in prod.

create table if not exists public.builder_pages (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null,
  brand_id          uuid references public.brands(id) on delete cascade,
  store_id          uuid,                          -- connected Shopify store (nullable; no FK to stay decoupled)
  template_id       text not null,                 -- e.g. 'advertorial_v1'
  type              text not null,                 -- 'advertorial' | 'listicle'
  product_id        text,                          -- Shopify product id/gid the page sells
  product_name      text,
  cta_href          text,                          -- where the CTAs point (PDP / cart)
  persona           jsonb,                         -- chosen persona
  angle             jsonb,                         -- chosen marketing angle
  research_ref      text,                          -- pointer to uploaded research, if any
  content           jsonb,                         -- filled { slot: value } — re-render source of truth
  render_opts       jsonb,                         -- RenderOpts (productName/image/rating/ctaHref) for re-render on publish
  preview_html      text,                          -- cached assembled document
  status            text default 'draft',          -- draft | published | failed
  shopify_page_id   text,
  shopify_url       text,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

create index if not exists idx_builder_pages_user on public.builder_pages(user_id, created_at desc);
create index if not exists idx_builder_pages_brand on public.builder_pages(brand_id, created_at desc);

alter table public.builder_pages enable row level security;
grant all on public.builder_pages to service_role;

-- Credit cost of a page build (the copy-generation pass). AI-generated images are billed separately
-- per image (image_clone_pro); real product photos are free. 1 credit = 1¢.
INSERT INTO credit_pricing (action_type, label, credits, est_cost_usd, is_active) VALUES
  ('page_build', 'Landing page · AI copy', 150, 0.05, true)
ON CONFLICT (action_type) DO UPDATE SET credits=EXCLUDED.credits, label=EXCLUDED.label, est_cost_usd=EXCLUDED.est_cost_usd, is_active=true;
