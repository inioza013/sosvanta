-- SOSVANTA: serialize Midtrans reservation against wallet checkout.
-- Both payment paths lock the same orders row, preventing cross-provider double payment.

create or replace function public.reserve_midtrans_payment(
  p_order_id uuid,
  p_provider_order_id text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_payment_id uuid;
  v_amount numeric(14,2);
begin
  if p_order_id is null then
    raise exception 'ID pesanan wajib diisi.';
  end if;

  if p_provider_order_id is null
     or length(trim(p_provider_order_id)) < 1
     or length(trim(p_provider_order_id)) > 100 then
    raise exception 'ID transaksi Midtrans tidak valid.';
  end if;

  -- This row lock is shared with pay_order_with_wallet().
  select * into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'Pesanan tidak ditemukan.';
  end if;

  if v_order.status <> 'awaiting_payment' then
    raise exception 'Pesanan belum siap dibayar.';
  end if;

  if v_order.currency <> 'IDR'
     or v_order.quoted_amount is null
     or v_order.quoted_amount < 1
     or v_order.quoted_amount <> trunc(v_order.quoted_amount) then
    raise exception 'Nominal penawaran belum valid.';
  end if;

  -- A wallet debit or any already-paid provider blocks Midtrans reservation.
  if exists (
    select 1 from public.wallet_transactions
    where order_id = v_order.id
  ) or exists (
    select 1 from public.payments
    where order_id = v_order.id and status = 'paid'
  ) then
    raise exception 'Pesanan ini sudah dibayar. Periksa riwayat pembayaran terlebih dahulu.';
  end if;

  -- Do not create a second active payment while another provider is pending.
  if exists (
    select 1 from public.payments
    where order_id = v_order.id and status = 'pending'
  ) then
    raise exception 'Pesanan memiliki tagihan yang masih tertunda. Periksa tagihan sebelumnya terlebih dahulu.';
  end if;

  v_amount := v_order.quoted_amount;

  insert into public.payments (
    order_id, provider, provider_order_id, amount, currency, status
  ) values (
    v_order.id, 'midtrans', trim(p_provider_order_id), v_amount, 'IDR', 'pending'
  )
  returning id into v_payment_id;

  return v_payment_id;
end;
$$;

revoke all on function public.reserve_midtrans_payment(uuid,text)
from public, anon, authenticated;
grant execute on function public.reserve_midtrans_payment(uuid,text)
to service_role;
