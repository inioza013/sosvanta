-- SOSVANTA database foundation
-- Run this file in Supabase SQL Editor on a NEW project.
-- Uses Supabase Auth (auth.users) and Row Level Security.

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Customer/admin profile. Never allow users to set their own role through client policies.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  phone text,
  role text not null default 'customer' check (role in ('customer','admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text,
  price numeric(14,2),
  price_label text,
  billing_type text not null default 'custom' check (billing_type in ('one_time','monthly','project','custom')),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  customer_id uuid not null references auth.users(id) on delete restrict,
  service_id uuid references public.services(id) on delete set null,
  package_name text,
  platform text,
  brand_name text,
  customer_name text not null,
  customer_phone text,
  brief text not null,
  admin_notes text,
  quoted_amount numeric(14,2),
  currency char(3) not null default 'IDR',
  status text not null default 'submitted'
    check (status in ('submitted','under_review','quoted','awaiting_payment','paid','in_progress','revision','completed','cancelled','rejected')),
  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.order_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  old_status text,
  new_status text,
  message text,
  is_customer_visible boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  provider text not null check (provider in ('midtrans','xendit','manual','other')),
  provider_reference text unique,
  amount numeric(14,2) not null check (amount >= 0),
  currency char(3) not null default 'IDR',
  status text not null default 'pending'
    check (status in ('pending','paid','failed','expired','refunded','cancelled')),
  paid_at timestamptz,
  raw_notification jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists orders_customer_created_idx on public.orders(customer_id, created_at desc);
create index if not exists orders_status_created_idx on public.orders(status, created_at desc);
create index if not exists order_events_order_created_idx on public.order_events(order_id, created_at desc);
create index if not exists payments_order_idx on public.payments(order_id);

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at before update on public.profiles
for each row execute function public.set_updated_at();
drop trigger if exists services_updated_at on public.services;
create trigger services_updated_at before update on public.services
for each row execute function public.set_updated_at();
drop trigger if exists orders_updated_at on public.orders;
create trigger orders_updated_at before update on public.orders
for each row execute function public.set_updated_at();
drop trigger if exists payments_updated_at on public.payments;
create trigger payments_updated_at before update on public.payments
for each row execute function public.set_updated_at();

-- Create a profile automatically for each new Auth user.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, full_name, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(new.raw_user_meta_data ->> 'phone', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- Helper: admin role is read from profiles, not from user-editable metadata.
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'admin'
  );
$$;

alter table public.profiles enable row level security;
alter table public.services enable row level security;
alter table public.orders enable row level security;
alter table public.order_events enable row level security;
alter table public.payments enable row level security;

-- Profiles: customer reads/updates own basic profile; admins can read all.
drop policy if exists "profile_select_own_or_admin" on public.profiles;
create policy "profile_select_own_or_admin" on public.profiles
for select to authenticated using (id = (select auth.uid()) or public.is_admin());
drop policy if exists "profile_update_own" on public.profiles;
create policy "profile_update_own" on public.profiles
for update to authenticated using (id = (select auth.uid()))
with check (id = (select auth.uid()) and role = 'customer');
drop policy if exists "profile_admin_update" on public.profiles;
create policy "profile_admin_update" on public.profiles
for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- Services: visible to everyone when active; only admins manage.
drop policy if exists "services_read_active" on public.services;
create policy "services_read_active" on public.services
for select to anon, authenticated using (is_active = true or public.is_admin());
drop policy if exists "services_admin_all" on public.services;
create policy "services_admin_all" on public.services
for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Orders: customer can submit/read own order; admin can manage.
drop policy if exists "orders_customer_insert" on public.orders;
create policy "orders_customer_insert" on public.orders
for insert to authenticated with check (customer_id = (select auth.uid()) and status = 'submitted');
drop policy if exists "orders_customer_select" on public.orders;
create policy "orders_customer_select" on public.orders
for select to authenticated using (customer_id = (select auth.uid()) or public.is_admin());
drop policy if exists "orders_admin_update" on public.orders;
create policy "orders_admin_update" on public.orders
for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "orders_admin_delete" on public.orders;
create policy "orders_admin_delete" on public.orders
for delete to authenticated using (public.is_admin());

-- Events: customers only see customer-visible events for their orders; admins manage.
drop policy if exists "events_customer_select" on public.order_events;
create policy "events_customer_select" on public.order_events
for select to authenticated using (
  is_customer_visible = true and exists (
    select 1 from public.orders o
    where o.id = order_id and o.customer_id = (select auth.uid())
  )
  or public.is_admin()
);
drop policy if exists "events_admin_insert" on public.order_events;
create policy "events_admin_insert" on public.order_events
for insert to authenticated with check (public.is_admin());
drop policy if exists "events_admin_update" on public.order_events;
create policy "events_admin_update" on public.order_events
for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "events_admin_delete" on public.order_events;
create policy "events_admin_delete" on public.order_events
for delete to authenticated using (public.is_admin());

-- Payment rows are private. Client cannot create or alter payment records.
drop policy if exists "payments_customer_select" on public.payments;
create policy "payments_customer_select" on public.payments
for select to authenticated using (
  exists (
    select 1 from public.orders o
    where o.id = order_id and o.customer_id = (select auth.uid())
  ) or public.is_admin()
);
drop policy if exists "payments_admin_update" on public.payments;
create policy "payments_admin_update" on public.payments
for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- Seed launch services. Prices are IDR and match the approved launch price list.
insert into public.services (slug, name, description, price, price_label, billing_type, sort_order)
values
 ('social-media-starter','Social Media Starter','1 platform; 8 feed posts; 4 simple stories; captions, calendar, scheduling and basic monthly report.',1490000,'Rp1.490.000/bulan','monthly',10),
 ('social-media-growth','Social Media Growth','Instagram and TikTok; 12 combined content pieces including up to 4 short-video edits and 8 static designs.',3490000,'Rp3.490.000/bulan','monthly',20),
 ('social-media-pro','Social Media Pro','Up to 2 platforms; 20 combined content pieces including up to 8 short-video edits.',6490000,'Rp6.490.000/bulan','monthly',30),
 ('profile-optimization','Audit & optimasi profil','One-time profile audit and optimization.',299000,'Rp299.000','one_time',40),
 ('five-content-designs','5 desain konten','Five social media design assets.',499000,'Rp499.000','one_time',50),
 ('five-short-video-edits','5 edit video pendek','Five short-form video edits using client-provided footage.',999000,'Rp999.000','one_time',60),
 ('content-strategy','Strategi konten','One-time content strategy.',499000,'Rp499.000','one_time',70),
 ('ads-management','Ads Management','Management fee; advertising spend is separate.',750000,'Mulai Rp750.000/bulan','monthly',80),
 ('creator-campaign','Creator Campaign Management','Management fee; creator talent and production costs are separate.',1500000,'Mulai Rp1.500.000/proyek','project',90)
on conflict (slug) do update set
 name = excluded.name,
 description = excluded.description,
 price = excluded.price,
 price_label = excluded.price_label,
 billing_type = excluded.billing_type,
 sort_order = excluded.sort_order,
 updated_at = now();

-- After creating your own Auth account, promote its UUID to admin manually in SQL Editor:
-- update public.profiles set role = 'admin' where id = 'YOUR_AUTH_USER_UUID';
-- Never expose the Supabase service_role key in browser code.
