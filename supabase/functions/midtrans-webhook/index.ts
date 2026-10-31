import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function sha512(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-512", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const serverKey = Deno.env.get("MIDTRANS_SERVER_KEY");
  const production = Deno.env.get("MIDTRANS_IS_PRODUCTION") === "true";
  if (!supabaseUrl || !serviceKey || !serverKey) return json({ error: "Backend configuration missing" }, 503);

  let notification: Record<string, unknown>;
  try { notification = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const orderId = String(notification.order_id ?? "");
  const statusCode = String(notification.status_code ?? "");
  const grossAmount = String(notification.gross_amount ?? "");
  const signature = String(notification.signature_key ?? "");
  if (!orderId || !statusCode || !grossAmount || !signature) return json({ error: "Incomplete notification" }, 400);

  const expected = await sha512(orderId + statusCode + grossAmount + serverKey);
  if (expected !== signature.toLowerCase()) return json({ error: "Invalid signature" }, 401);

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: payment, error: paymentError } = await admin
    .from("payments")
    .select("id,order_id,amount,currency,status")
    .eq("provider", "midtrans")
    .eq("provider_order_id", orderId)
    .maybeSingle();
  if (paymentError) return json({ error: "Database lookup failed" }, 500);
  if (!payment) return json({ error: "Unknown payment order" }, 404);

  // Confirm the current canonical status directly with Midtrans; notifications may arrive out of order.
  const apiBase = production ? "https://api.midtrans.com" : "https://api.sandbox.midtrans.com";
  const statusResponse = await fetch(apiBase + "/v2/" + encodeURIComponent(orderId) + "/status", {
    headers: { "Accept": "application/json", "Authorization": "Basic " + btoa(serverKey + ":") },
  });
  if (!statusResponse.ok) return json({ error: "Could not verify transaction status with Midtrans" }, 503);
  const current = await statusResponse.json();
  const canonicalAmount = Number(current.gross_amount);
  const canonicalCurrency = String(current.currency ?? "");
  if (String(current.order_id ?? "") !== orderId ||
      !Number.isFinite(canonicalAmount) ||
      canonicalAmount !== Number(payment.amount) ||
      canonicalCurrency !== "IDR" ||
      payment.currency !== "IDR") {
    return json({ error: "Payment amount or currency mismatch" }, 409);
  }

  const transactionStatus = String(current.transaction_status ?? "");
  const fraudStatus = String(current.fraud_status ?? "");
  let nextPaymentStatus = "pending";
  let paid = false;
  if (String(current.status_code ?? "") === "200" &&
      (transactionStatus === "settlement" || transactionStatus === "capture") &&
      (!current.fraud_status || fraudStatus === "accept")) {
    nextPaymentStatus = "paid";
    paid = true;
  } else if (transactionStatus === "expire") nextPaymentStatus = "expired";
  else if (transactionStatus === "cancel") nextPaymentStatus = "cancelled";
  else if (transactionStatus === "deny" || transactionStatus === "failure") nextPaymentStatus = "failed";
  else if (transactionStatus === "refund" || transactionStatus === "partial_refund") nextPaymentStatus = "refunded";

  // Do not let delayed pending/failed notifications downgrade a confirmed settlement.
  if (payment.status === "paid" && !["paid", "refunded"].includes(nextPaymentStatus)) nextPaymentStatus = "paid";
  const { error: updatePaymentError } = await admin.from("payments").update({
    status: nextPaymentStatus,
    provider_reference: current.transaction_id ? String(current.transaction_id) : null,
    payment_method: current.payment_type ? String(current.payment_type) : null,
    ...(paid ? { paid_at: current.settlement_time || new Date().toISOString() } : {}),
    raw_notification: notification,
  }).eq("id", payment.id);
  if (updatePaymentError) return json({ error: "Could not update payment" }, 500);

  if (paid) {
    const { error: updateOrderError } = await admin.from("orders")
      .update({ status: "paid" }).eq("id", payment.order_id);
    if (updateOrderError) return json({ error: "Payment saved but order update failed" }, 500);
  }
  return json({ received: true });
});
