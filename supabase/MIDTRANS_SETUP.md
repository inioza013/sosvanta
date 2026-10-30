# Midtrans Snap — preparation only

This directory contains an un-deployed integration scaffold. It does not register a Midtrans merchant, enable payment collection, deploy functions, or use live credentials.

## Architecture
- `midtrans-create-payment`: authenticated customer endpoint. Only the owner of an order in `awaiting_payment` can request a Snap URL. Amount comes from the admin-set `orders.quoted_amount`, never from browser input.
- `midtrans-webhook`: verifies Midtrans SHA-512 signature, then fetches canonical transaction status from Midtrans before updating payment/order state. It is designed to tolerate duplicate and out-of-order notifications.
- `migrations/20261030_midtrans_snap.sql`: adds fields for Snap token, redirect URL and provider order ID.

## Not deployed / not activated
No Supabase migration has been applied, no Edge Function deployed, no Midtrans account created, and no Sandbox or Production key configured. Existing site behavior remains unchanged.

## Required steps when explicitly approved
1. Apply the migration in Supabase SQL Editor.
2. Deploy both functions to the existing Supabase project.
3. Configure function secrets (never in GitHub/browser):
   - `MIDTRANS_SERVER_KEY` = Sandbox Server Key initially
   - `MIDTRANS_IS_PRODUCTION` = `false`
   - Supabase supplies `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` to Edge Functions.
4. Configure Midtrans Sandbox notification URL to the deployed `midtrans-webhook` endpoint.
5. Test with Sandbox payment methods and verify payment/order status changes.
6. Only after explicit approval and merchant onboarding, review production keys and go-live settings.

## Important
- Never put Server Key or Supabase service-role key in `script.js`, HTML, or public GitHub.
- Use a distinct unique provider order ID per payment attempt.
- Only `settlement`, or `capture` with acceptable fraud status, is treated as paid.
- Reconcile status using Midtrans GET Status API; do not trust the browser redirect as proof of payment.
