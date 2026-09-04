-- Page Builder — visual editor (the "page is the document" model).
-- Once a page is edited in the click-anywhere visual editor, the edited HTML BODY becomes the source of
-- truth for preview + publish (Framer/Webflow-style). `content` (slots) is kept for reference + regenerate.
-- `edited_html` is the assembled BODY (no <html>/<head>) so publish can wrap it exactly like a re-render.
-- NOTE (standing rule): pause the crawl / drain writes before applying this in prod.

alter table public.builder_pages
  add column if not exists edited_html   text,          -- visual-editor body HTML; when set, wins over content on preview/publish
  add column if not exists blocks        jsonb,         -- ordered custom sections added via the agent/block library (audit + re-render)
  add column if not exists edited_at      timestamptz;   -- last visual edit (distinguish a hand-edited page from a freshly generated one)
