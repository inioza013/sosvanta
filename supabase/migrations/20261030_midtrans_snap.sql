-- Midtrans Snap preparation for SOSVANTA.
-- Apply manually in Supabase SQL Editor. No payment provider is activated by this file.
alter table public.payments
  add column if not exists provider_order_id text,
  add column if not exists snap_token text,
  add column if not exists redirect_url text,
  add column if not exists expires_at timestamptz,
  add column if not exists payment_method text;

create unique index if not exists payments_provider_order_id_uidx
  on public.payments(provider_order_id)
  where provider_order_id is not null;

-- Keep payment rows readable only by the owning customer and admins.
-- Existing RLS policies from schema.sql remain in force.
