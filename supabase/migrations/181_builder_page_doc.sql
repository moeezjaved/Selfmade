-- Advanced Page Builder — structured page model (Phase 1 of docs/specs/2026-09-12-advanced-page-builder.md).
-- Adds the typed PageDoc (Section→Block→Element + StyleProps) as the NEW source of truth for the advanced
-- visual editor, alongside the existing content/edited_html paths (kept for the current editor + regenerate).
-- Purely additive: nothing is dropped, old pages keep working until the new editor is at parity (behind a flag).
-- NOTE (standing rule): pause the crawl / drain writes before applying this in prod (schema reload under load 503s).

alter table public.builder_pages
  add column if not exists doc          jsonb,          -- the PageDoc structured model (advanced editor source of truth)
  add column if not exists doc_version  int  default 0, -- monotonically increasing; bumped on every doc save
  add column if not exists doc_edited_at timestamptz;   -- last structured-model edit

-- Version history for undo / revert (one row per saved doc version). Bounded pruning happens in app code.
create table if not exists public.builder_page_versions (
  id          uuid primary key default gen_random_uuid(),
  page_id     uuid not null references public.builder_pages(id) on delete cascade,
  version     int  not null,
  doc         jsonb not null,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  unique (page_id, version)
);

create index if not exists builder_page_versions_page_idx
  on public.builder_page_versions (page_id, version desc);

comment on column public.builder_pages.doc is
  'PageDoc structured model (src/lib/builder/schema.ts) — advanced visual editor source of truth. Rendered by render.ts for both canvas and Shopify publish.';
comment on table public.builder_page_versions is
  'Advanced page builder version history — one row per saved doc version for undo/revert.';
