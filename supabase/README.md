# SOSVANTA — Supabase setup

This folder contains the first database foundation for the SOSVANTA order system.

## Included
- `schema.sql`: tables, indexes, profile trigger, row-level security (RLS), and the approved launch-service catalogue.
- Tables: `profiles`, `services`, `orders`, `order_events`, `payments`.

## Setup
1. Create a Supabase project in the Supabase dashboard. Choose a region close to your customers (typically Singapore for Indonesia, if available).
2. Open **SQL Editor → New query**.
3. Copy all contents of `schema.sql` into the editor and run it.
4. In **Authentication → Users**, create your own administrator login account.
5. Find that user's UUID, then in SQL Editor run:
   ```sql
   update public.profiles
   set role = 'admin'
   where id = 'PASTE-YOUR-AUTH-USER-UUID-HERE';
   ```
6. Verify that the nine approved services appear in **Table Editor → services**.

## Security notes
- RLS is enabled for all application tables.
- Customers can only read their own profile, orders, visible order events, and related payment status.
- Customers cannot create or modify payment records.
- Only an administrator can manage service catalogue entries and order status.
- The admin role must be assigned manually in SQL Editor. Never expose or let a customer edit their role.
- Never put the Supabase `service_role` key, payment secrets, or webhook secrets in website JavaScript or public GitHub files.

## Current limitation
The current SOSVANTA website still sends its brief to WhatsApp. It does not yet create a database order. The next development step is to add secure authentication and connect the customer order form to Supabase using the public anon/publishable key with RLS, then build the admin view. Payment gateway integration comes later.

## Launch prices seeded
Starter Rp1.490.000/month; Growth Rp3.490.000/month; Pro Rp6.490.000/month; profile optimization Rp299.000; five designs Rp499.000; five short-video edits Rp999.000; content strategy Rp499.000; Ads Management from Rp750.000/month; Creator Campaign Management from Rp1.500.000/project.
