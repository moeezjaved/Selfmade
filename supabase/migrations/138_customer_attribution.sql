-- Attribution: mark a customer conversation as having led to a sale (and its value), so the Customer
-- Employee can show a real revenue number — "Mello handled N, M led to sales, €X." The founder marks it
-- now (one tap); when Shopify is connected this can be set automatically from orders. Additive columns.
alter table public.customer_threads add column if not exists converted   boolean not null default false;
alter table public.customer_threads add column if not exists sale_value   numeric;
alter table public.customer_threads add column if not exists converted_at timestamptz;
