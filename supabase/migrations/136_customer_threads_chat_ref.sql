-- Store the channel's conversation id on the thread, so an approved reply is sent INTO the existing
-- conversation (required for Instagram/WhatsApp replies — you can't start a fresh chat by handle within
-- the messaging window). Without it, replies silently failed to appear. Small additive column.
alter table public.customer_threads add column if not exists chat_ref text;
