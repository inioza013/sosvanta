import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") ?? "https://inioza013.github.io",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json({ error: "Login admin diperlukan." }, 401);
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const serverKey = Deno.env.get("MIDTRANS_SERVER_KEY");
  const production = Deno.env.get("MIDTRANS_IS_PRODUCTION") === "true";
  if (!url || !anonKey || !serviceKey || !serverKey) return json({ error: "Konfigurasi backend belum lengkap." }, 503);

  const auth = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data: userData, error: authError } = await auth.auth.getUser();
  if (authError || !userData.user) return json({ error: "Sesi login tidak valid." }, 401);
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: profile } = await admin.from("profiles").select("role").eq("id", userData.user.id).maybeSingle();
  if (profile?.role !== "admin") return json({ error: "Akses admin diperlukan." }, 403);

  let body: { order_id?: string };
  try { body = await req.json(); } catch { return json({ error: "Format permintaan tidak valid." }, 400); }
  if (!body.order_id) return json({ error: "order_id wajib diisi." }, 400);
  const { data: order, error: orderError } = await admin.from("orders").select("id,status").eq("id", body.order_id).maybeSingle();
  if (orderError || !order) return json({ error: "Pesanan tidak ditemukan." }, 404);
  const { data: payments, error: paymentsError } = await admin.from("payments")
    .select("id,provider_order_id,amount,status").eq("order_id", order.id).eq("provider", "midtrans");
  if (paymentsError) return json({ error: "Gagal membaca catatan pembayaran." }, 500);

  const apiBase = production ? "https://api.midtrans.com" : "https://api.sandbox.midtrans.com";
  const results: Array<Record<string, unknown>> = [];
  let settledCount = 0;
  for (const payment of payments ?? []) {
    if (!payment.provider_order_id) continue;
    const response = await fetch(apiBase + "/v2/" + encodeURIComponent(payment.provider_order_id) + "/status", {
      headers: { "Accept": "application/json", "Authorization": "Basic " + btoa(serverKey + ":") },
    });
    if (response.status === 404) { results.push({ provider_order_id: payment.provider_order_id, result: "not_found" }); continue; }
    if (!response.ok) { results.push({ provider_order_id: payment.provider_order_id, result: "provider_error", http_status: response.status }); continue; }
    const current = await response.json();
    const amount = Number(current.gross_amount);
    if (String(current.order_id ?? "") !== payment.provider_order_id || !Number.isFinite(amount) || amount !== Number(payment.amount)) {
      results.push({ provider_order_id: payment.provider_order_id, result: "mismatch" }); continue;
    }
    const tx = String(current.transaction_status ?? "");
    const fraud = String(current.fraud_status ?? "");
    let next = "pending";
    if (String(current.status_code ?? "") === "200" && (tx === "settlement" || tx === "capture") && (!current.fraud_status || fraud === "accept")) next = "paid";
    else if (tx === "expire") next = "expired";
    else if (tx === "cancel") next = "cancelled";
    else if (tx === "deny" || tx === "failure") next = "failed";
    else if (tx === "refund" || tx === "partial_refund") next = "refunded";
    // Preserve confirmed settlement if a stale/non-terminal response arrives later.
    if (payment.status === "paid" && !["paid", "refunded"].includes(next)) next = "paid";
    const update: Record<string, unknown> = {
      status: next,
      raw_notification: { _reconciled_by: "midtrans-status-api", transaction_status: tx, status_code: current.status_code, transaction_id: current.transaction_id ?? null, payment_type: current.payment_type ?? null },
    };
    if (current.transaction_id) update.provider_reference = String(current.transaction_id);
    if (current.payment_type) update.payment_method = String(current.payment_type);
    if (next === "paid") update.paid_at = current.settlement_time || new Date().toISOString();
    const { error: updateError } = await admin.from("payments").update(update).eq("id", payment.id);
    if (updateError) { results.push({ provider_order_id: payment.provider_order_id, result: "database_error" }); continue; }
    if (next === "paid") settledCount++;
    results.push({ provider_order_id: payment.provider_order_id, result: next, transaction_id: current.transaction_id ?? null });
  }

  if (settledCount > 0 && order.status !== "paid") {
    const { error: orderUpdateError } = await admin.from("orders").update({ status: "paid" }).eq("id", order.id);
    if (orderUpdateError) return json({ error: "Pembayaran tercatat, tetapi status pesanan gagal diperbarui.", results }, 500);
    await admin.from("order_events").insert({
      order_id: order.id, actor_id: userData.user.id, old_status: order.status, new_status: "paid",
      message: settledCount > 1
        ? "Pembayaran Midtrans terverifikasi. Terdapat " + settledCount + " transaksi Settlement pada satu pesanan; pembayaran berlebih perlu ditinjau admin."
        : "Pembayaran Midtrans terverifikasi melalui status API.",
      is_customer_visible: true,
    });
  }
  return json({ order_id: order.id, order_status: settledCount > 0 ? "paid" : order.status, settled_count: settledCount, results });
});
