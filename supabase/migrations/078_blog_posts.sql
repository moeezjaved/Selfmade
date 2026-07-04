-- Blog CMS — SEO content authored from /admin/blog, served at /blog + /blog/[slug].
create table if not exists blog_posts (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  title text not null,
  excerpt text,                       -- short summary for cards + meta description fallback
  cover_image_url text,               -- hero image (R2/any URL)
  body_md text not null default '',   -- markdown body
  author text default 'Selfmade',
  tags text[] default '{}',
  meta_description text,               -- SEO description override (falls back to excerpt)
  status text not null default 'draft',   -- draft | published
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists blog_posts_slug_idx on blog_posts (slug);
create index if not exists blog_posts_pub_idx on blog_posts (status, published_at desc) where status = 'published';
