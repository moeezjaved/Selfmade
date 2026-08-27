-- Store the SEO targeting for a drafted page so Content can SHOW it before publishing:
--   { keyword, metaTitle, metaDescription, secondary: [related keywords the article also targets] }
alter table public.geo_assets add column if not exists seo jsonb;
