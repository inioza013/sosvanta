-- Prevent an order from being marked paid unless a verified Midtrans payment exists.
-- Apply this migration in the Supabase SQL Editor.
create or replace function public.prevent_unverified_paid_order()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'paid'
     and old.status is distinct from 'paid'
     and not exists (
       select 1
       from public.payments p
       where p.order_id = new.id
         and p.provider = 'midtrans'
         and p.status = 'paid'
     ) then
    raise exception 'Order cannot be marked paid without a verified Midtrans payment.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_unverified_paid_order on public.orders;

create trigger trg_prevent_unverified_paid_order
before update of status on public.orders
for each row
execute function public.prevent_unverified_paid_order();
