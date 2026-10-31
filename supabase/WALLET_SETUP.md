# SOSVANTA Stage 3 — Wallet foundation

## What this stage adds
- Append-only wallet transaction ledger; balance is calculated from credits minus debits, not stored in a browser-editable balance field.
- Customer deposit requests with a minimum amount of Rp1.000.
- Admin-only approval/rejection through a role-checked SQL function.
- Atomic wallet payment for an order in `awaiting_payment`, with a row lock, balance check, one-payment-per-order index, payment record, and customer-visible order event.
- Order paid-state protection now accepts either a verified Midtrans payment or a matching wallet debit record.

## Free / manual operating model
This stage uses no paid gateway, supplier API, or external service. A deposit request is only a request; it does not prove funds arrived. Admin must independently confirm receipt in the business bank/e-wallet account before approving it. SOSVANTA must provide verified transfer instructions to customers separately. Do not claim an automatic bank transfer or instant top-up.

## Apply in Supabase
1. Open Supabase Dashboard → SQL Editor.
2. Review and run `supabase/migrations/20261031010000_wallet_ledger.sql`.
3. Verify tables `wallet_accounts`, `wallet_deposit_requests`, and `wallet_transactions`.
4. Verify functions `request_wallet_deposit`, `review_wallet_deposit`, `wallet_balance`, and `pay_order_with_wallet`.

This is a database migration only. It has NOT been applied to the live Supabase project by this repository commit.

## Manual verification checklist
- Customer A can request a deposit; Customer B cannot read A's requests or ledger.
- Customer cannot insert/update/delete wallet ledger rows directly.
- Customer cannot approve a deposit; a non-admin RPC call is rejected.
- Admin can approve a pending request once; second approval/rejection attempt is rejected.
- Rejected requests create no wallet credit.
- Wallet balance equals ledger credits minus debits.
- Paying an order with insufficient funds fails without writing a debit or marking the order paid.
- Paying an eligible order deducts exactly the quoted IDR amount and marks it paid once.
- A second payment attempt for the same order fails.
- Customers cannot set orders to paid directly.
- A pending deposit request must never be approved until the actual incoming funds are independently confirmed.

## Important
The customer/admin screens do not yet expose wallet balances or deposit review. That UI is the next stage. Existing Midtrans scaffold remains separate and un-deployed. Do not deploy or activate Midtrans for this free/manual wallet stage.
