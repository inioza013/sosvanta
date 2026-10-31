-- SOSVANTA: read-only wallet migration verification.
-- Run after schema.sql and all required migrations have been applied.
-- This script does not modify database objects or customer data.

with expected_tables(name) as (
  values
    ('public.profiles'),
    ('public.orders'),
    ('public.payments'),
    ('public.wallet_accounts'),
    ('public.wallet_deposit_requests'),
    ('public.wallet_transactions')
),
table_checks as (
  select name, to_regclass(name) is not null as present
  from expected_tables
),
expected_functions(name) as (
  values
    ('wallet_balance'),
    ('request_wallet_deposit'),
    ('review_wallet_deposit'),
    ('pay_order_with_wallet'),
    ('prevent_unverified_paid_order'),
    ('is_admin')
),
function_checks as (
  select e.name,
         exists (
           select 1 from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = e.name
         ) as present
  from expected_functions e
),
expected_triggers(name, relation_name) as (
  values
    ('trg_prevent_unverified_paid_order','orders')
),
trigger_checks as (
  select e.name,
         exists (
           select 1 from pg_trigger t
           join pg_class c on c.oid = t.tgrelid
           join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public'
             and c.relname = e.relation_name
             and t.tgname = e.name
             and not t.tgisinternal
         ) as present
  from expected_triggers e
),
expected_policies(table_name, policy_name) as (
  values
    ('wallet_accounts','wallet_account_read_own_admin'),
    ('wallet_deposit_requests','wallet_deposit_read_own_admin'),
    ('wallet_transactions','wallet_tx_read_own_admin')
),
policy_checks as (
  select e.table_name, e.policy_name,
         exists (
           select 1 from pg_policies p
           where p.schemaname = 'public'
             and p.tablename = e.table_name
             and p.policyname = e.policy_name
         ) as present
  from expected_policies e
)
select 'table' as check_type, name as object_name, present from table_checks
union all
select 'function', name, present from function_checks
union all
select 'trigger', name, present from trigger_checks
union all
select 'policy', table_name || '.' || policy_name, present from policy_checks
order by check_type, object_name;

-- Verify RLS is enabled on all wallet tables.
select c.relname as wallet_table, c.relrowsecurity as rls_enabled
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('wallet_accounts','wallet_deposit_requests','wallet_transactions')
order by c.relname;

-- Expected result: every "present" and "rls_enabled" value is true.
