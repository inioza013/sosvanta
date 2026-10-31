# SOSVANTA Stage 5 — QA and release gate

## Scope
This checklist applies only to branch `safe-smm-panel-mvp`. The production `main` branch must remain unchanged until the checks pass and the owner explicitly approves deployment.

## Static checks completed
- JavaScript files parse without syntax errors.
- Wallet/admin scripts reference HTML elements that exist.
- Browser code uses only the Supabase publishable key; never place a service-role key in frontend files.
- Wallet deposit approval UI checks the signed-in user's `profiles.role` and the database RPC independently checks admin authorization.
- Wallet ledger writes are performed through SQL functions, not direct browser inserts.
- Wallet order payment uses a database transaction with row locking and duplicate-payment protections.

## Supabase migration prerequisites
Before running the wallet migration, confirm that the base `supabase/schema.sql` and `20261030_midtrans_snap.sql` and `20261031000000_prevent_unverified_paid_orders.sql` have been applied in the intended Supabase project. Review the SQL in the dashboard first. Do not run it against a production project until the owner explicitly authorizes that action.

## Manual end-to-end test plan
Use two separate customer accounts (A and B) and one admin account.

1. Customer A registers and signs in; profile role defaults to `customer`.
2. Customer A requests a deposit. The request appears as pending; wallet balance remains unchanged.
3. Customer B cannot read Customer A's deposit request or ledger entries.
4. Customer A cannot approve a deposit or write directly to wallet ledger tables.
5. A non-admin account cannot access the admin deposit queue or execute `review_wallet_deposit`.
6. Admin sees pending requests and approves only after independently confirming the incoming transfer.
7. Approved deposit creates exactly one credit ledger entry; repeating the approval is rejected.
8. Rejected deposit creates no credit entry.
9. Customer A can see their own updated balance and transaction history.
10. A wallet payment with insufficient funds fails and creates no debit/payment record.
11. Wallet checkout is blocked if the order has a pending or already-paid Midtrans transaction; verify that this prevents a second payment path.
12. A valid wallet payment deducts exactly the quoted IDR amount and changes the order to paid.
13. Repeating payment for the same order is rejected; a customer cannot mark an order paid directly.
14. Confirm logout, session expiry, mobile layout, and browser console/network errors.

## Known limitations
- No automated browser or live Supabase end-to-end tests have been run from this repository review.
- The wallet migration has not been applied to Supabase by these commits.
- No deposit, payment, bank connection, supplier API, or automated fulfillment is active.
- Midtrans remains a separate integration and must not be activated without explicit approval and review of any fees.
- GitHub Pages is static hosting; it does not run server-side code or apply database migrations.

## Release gate
Do not merge to `main` or publish until the migration is reviewed/applied in a test project, the manual tests pass, and the owner explicitly approves deployment.
