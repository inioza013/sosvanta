# SOSVANTA customer panel — MVP test checklist

This is an isolated development branch. Do not merge into `main` until the checklist is complete.

## Implemented in this milestone
- Separate customer workspace at `panel.html`.
- Supabase Auth login, sign-up, and sign-out using the existing public publishable key.
- Active service catalogue read from `public.services`.
- Customer order creation in `public.orders`.
- Customer order history/status from the existing row-level security policies.
- Homepage navigation link to the customer panel.

## Not enabled yet
- Wallet balance and top-ups.
- Reseller accounts, tiered wholesale pricing, and commissions.
- Automated supplier/API fulfillment.
- Payment checkout from the panel.
- Admin support ticket center.
These require additional database policies, server-side validation, and security testing. The interface deliberately does not pretend that a wallet or automated fulfillment is already available.

## Pre-release tests
1. Confirm Supabase Auth email confirmation and redirect URLs include the exact panel URL on the eventual hosting domain.
2. Register a new test customer and confirm the email.
3. Sign in and verify only active services appear.
4. Create an Instagram test request and a TikTok test request.
5. Confirm each order appears in the customer history and that a second customer cannot read it.
6. Verify an unauthenticated visitor cannot submit an order.
7. Verify the customer cannot change order status, quoted price, or another customer's data.
8. Verify admin review/status updates still work with the existing admin workspace.
9. Test mobile layout, sign-out, session refresh, and expired-session behavior.
10. Only after passing tests, review the branch diff and decide whether to merge.

## Free-budget guardrails
- Keep the current static hosting and Supabase free-tier setup while within their published limits.
- Do not add a paid payment gateway, paid supplier, paid domain, or paid hosting without explicit approval.
- A zero-cost MVP can accept and track service requests; it cannot promise free payment processing, free supplier fulfillment, or unlimited scale.
- Never put Supabase service-role keys, payment secrets, supplier API keys, or webhook secrets in browser JavaScript or public repository files.

## Stage 2 — admin workspace
- Open `admin.html`; the page must deny access to customer-role accounts.
- Confirm an admin-role account can see all orders and customer profile details.
- Filter orders by status and search by order number or brand.
- Update an order to under review, set a quote, and add a customer-visible note.
- Set a quote and move an order to awaiting payment; verify the customer sees the quote and payment action.
- Confirm the admin UI cannot manually mark an unpaid order as paid.
- Confirm paid orders have locked status and quote controls; payment status must come from Midtrans verification only.
- Verify order status/note/quote changes are recorded in `order_events`.
- Add a test service, verify it appears in the customer catalogue, then deactivate it and verify it disappears.
- Test a non-admin account against direct `admin.html` access; it must not reveal order or service data.

## Admin setup requirement
The admin page uses the existing `profiles.role` authorization check. To authorize the owner's account, first register and confirm the account, then copy its Auth user UUID from Supabase Dashboard > Authentication > Users. Run the following in Supabase SQL Editor after replacing the placeholder:
```sql
update public.profiles
set role = 'admin'
where id = 'PASTE_AUTH_USER_UUID_HERE';
```
Never put the service-role key in a browser file. Do not share passwords or private API keys in chat.
