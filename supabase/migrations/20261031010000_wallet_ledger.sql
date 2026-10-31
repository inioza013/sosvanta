-- SOSVANTA Stage 3: secure wallet ledger and manual deposit review.
-- Apply only after the base schema and Midtrans migrations have been applied.
-- This migration does not connect a bank, payment gateway, or paid API.

create table if not exists public.wallet_accounts (
  customer_id uuid primary key references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.wallet_deposit_requests (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references auth.users(id) on delete restrict,
  amount numeric(14,2) not null check (amount >= 1000 and amount = trunc(amount)),
  customer_reference text,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  admin_note text,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references auth.users(id) on delete restrict,
  deposit_request_id uuid references public.wallet_deposit_requests(id) on delete restrict,
  order_id uuid references public.orders(id) on delete restrict,
  transaction_type text not null check (transaction_type in ('deposit','order_payment','refund','adjustment')),
  amount numeric(14,2) not null check (amount > 0 and amount = trunc(amount)),
  direction text not null check (direction in ('credit','debit')),
  description text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint wallet_tx_source_check check (
    (transaction_type = 'deposit' and deposit_request_id is not null and order_id is null and direction = 'credit')
    or (transaction_type = 'order_payment' and order_id is not null and deposit_request_id is null and direction = 'debit')
    or (transaction_type in ('refund','adjustment') and deposit_request_id is null)
  )
);

create unique index if not exists wallet_tx_deposit_once
  on public.wallet_transactions(deposit_request_id) where deposit_request_id is not null;
create unique index if not exists wallet_tx_order_once
  on public.wallet_transactions(order_id) where order_id is not null;
create index if not exists wallet_tx_customer_created_idx
  on public.wallet_transactions(customer_id, created_at desc);
create index if not exists wallet_deposit_customer_created_idx
  on public.wallet_deposit_requests(customer_id, created_at desc);

alter table public.wallet_accounts enable row level security;
alter table public.wallet_deposit_requests enable row level security;
alter table public.wallet_transactions enable row level security;

drop policy if exists wallet_account_read_own_admin on public.wallet_accounts;
create policy wallet_account_read_own_admin on public.wallet_accounts
for select to authenticated using (customer_id = (select auth.uid()) or public.is_admin());

drop policy if exists wallet_deposit_read_own_admin on public.wallet_deposit_requests;
create policy wallet_deposit_read_own_admin on public.wallet_deposit_requests
for select to authenticated using (customer_id = (select auth.uid()) or public.is_admin());

-- No direct update policy: approvals must go through review_wallet_deposit()
-- so status changes and ledger credits happen atomically.
drop policy if exists wallet_deposit_admin_update on public.wallet_deposit_requests;

drop policy if exists wallet_tx_read_own_admin on public.wallet_transactions;
create policy wallet_tx_read_own_admin on public.wallet_transactions
for select to authenticated using (customer_id = (select auth.uid()) or public.is_admin());

-- No direct client insert/update/delete policies for ledger rows or account balances.
-- Balance is always calculated from the immutable transaction ledger.

create or replace function public.wallet_balance(p_customer_id uuid)
returns numeric
language sql stable security definer set search_path = ''
as $
begin
  if auth.uid() is null or (
    auth.uid() <> p_customer_id and not public.is_admin()
  ) then
    raise exception 'Tidak berwenang melihat saldo ini.';
  end if;
  return (
    select coalesce(sum(case when direction = 'credit' then amount else -amount end), 0)::numeric(14,2)
    from public.wallet_transactions
    where customer_id = p_customer_id
  );
end;
$;

create or replace function public.request_wallet_deposit(p_amount numeric, p_reference text default null)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'Login diperlukan.'; end if;
  if p_amount is null or p_amount < 1000 or p_amount <> trunc(p_amount) then
    raise exception 'Nominal minimal Rp1.000 dan harus berupa Rupiah bulat.';
  end if;
  insert into public.wallet_accounts(customer_id) values (auth.uid()) on conflict do nothing;
  insert into public.wallet_deposit_requests(customer_id, amount, customer_reference)
  values (auth.uid(), p_amount, nullif(left(trim(coalesce(p_reference,'')),120),''))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.review_wallet_deposit(p_request_id uuid, p_decision text, p_note text default null)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_req public.wallet_deposit_requests%rowtype;
begin
  if not public.is_admin() then raise exception 'Akses admin diperlukan.'; end if;
  if p_decision not in ('approved','rejected') then raise exception 'Keputusan tidak valid.'; end if;
  select * into v_req from public.wallet_deposit_requests where id = p_request_id for update;
  if not found then raise exception 'Permintaan deposit tidak ditemukan.'; end if;
  if v_req.status <> 'pending' then raise exception 'Permintaan ini sudah diproses.'; end if;

  if p_decision = 'approved' then
    insert into public.wallet_accounts(customer_id) values (v_req.customer_id) on conflict do nothing;
    insert into public.wallet_transactions(customer_id, deposit_request_id, transaction_type, amount, direction, description, created_by)
    values (v_req.customer_id, v_req.id, 'deposit', v_req.amount, 'credit', 'Deposit manual disetujui admin', auth.uid());
  end if;

  update public.wallet_deposit_requests
  set status = p_decision, admin_note = nullif(left(trim(coalesce(p_note,'')),1000),''),
      reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
  where id = v_req.id;
end;
$$;

create or replace function public.pay_order_with_wallet(p_order_id uuid)
returns numeric
language plpgsql security definer set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_balance numeric(14,2);
  v_amount numeric(14,2);
begin
  if auth.uid() is null then raise exception 'Login diperlukan.'; end if;
  select * into v_order from public.orders where id = p_order_id and customer_id = auth.uid() for update;
  if not found then raise exception 'Pesanan tidak ditemukan.'; end if;
  if v_order.status <> 'awaiting_payment' then raise exception 'Pesanan belum siap dibayar.'; end if;
  if v_order.currency <> 'IDR' or v_order.quoted_amount is null
     or v_order.quoted_amount < 1 or v_order.quoted_amount <> trunc(v_order.quoted_amount) then
    raise exception 'Nominal penawaran belum valid.';
  end if;
  if exists (select 1 from public.wallet_transactions where order_id = v_order.id) then
    raise exception 'Pesanan ini sudah pernah dibayar menggunakan saldo.';
  end if;

  insert into public.wallet_accounts(customer_id) values (auth.uid()) on conflict do nothing;
  perform 1 from public.wallet_accounts where customer_id = auth.uid() for update;
  v_balance := public.wallet_balance(auth.uid());
  v_amount := v_order.quoted_amount;
  if v_balance < v_amount then raise exception 'Saldo tidak mencukupi.'; end if;

  insert into public.wallet_transactions(customer_id, order_id, transaction_type, amount, direction, description, created_by)
  values (auth.uid(), v_order.id, 'order_payment', v_amount, 'debit', 'Pembayaran pesanan ' || v_order.order_number, auth.uid());

  -- Record a paid wallet payment so the order's paid-state guard can verify its source.
  insert into public.payments(order_id, provider, provider_reference, amount, currency, status, paid_at)
  values (v_order.id, 'manual', 'WALLET-' || v_order.id::text, v_amount, 'IDR', 'paid', now());

  update public.orders set status = 'paid' where id = v_order.id;
  insert into public.order_events(order_id, actor_id, old_status, new_status, message, is_customer_visible)
  values (v_order.id, auth.uid(), v_order.status, 'paid', 'Pembayaran berhasil menggunakan saldo SOSVANTA.', true);

  return v_balance - v_amount;
end;
$$;

-- Customers may call only the safe RPCs; admin review verifies role inside the function.
revoke all on function public.wallet_balance(uuid) from public, anon;
grant execute on function public.wallet_balance(uuid) to authenticated;
revoke all on function public.request_wallet_deposit(numeric,text) from public, anon;
grant execute on function public.request_wallet_deposit(numeric,text) to authenticated;
revoke all on function public.review_wallet_deposit(uuid,text,text) from public, anon;
grant execute on function public.review_wallet_deposit(uuid,text,text) to authenticated;
revoke all on function public.pay_order_with_wallet(uuid) from public, anon;
grant execute on function public.pay_order_with_wallet(uuid) to authenticated;

-- Allow paid orders only when there is a verified Midtrans payment OR a matching wallet debit.
create or replace function public.prevent_unverified_paid_order()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.status = 'paid' and old.status is distinct from 'paid'
     and not (
       exists (select 1 from public.payments p
               where p.order_id = new.id and p.provider = 'midtrans' and p.status = 'paid')
       or exists (select 1 from public.payments p
                  join public.wallet_transactions wt on wt.order_id = p.order_id
                  where p.order_id = new.id and p.provider = 'manual' and p.status = 'paid'
                    and wt.customer_id = new.customer_id
                    and wt.transaction_type = 'order_payment' and wt.direction = 'debit'
                    and wt.amount = p.amount and p.amount = new.quoted_amount)
     ) then
    raise exception 'Order cannot be marked paid without verified payment.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_prevent_unverified_paid_order on public.orders;
create trigger trg_prevent_unverified_paid_order
before update of status on public.orders
for each row execute function public.prevent_unverified_paid_order();

-- The ledger is append-only for authenticated clients: no direct writes are granted by RLS.
