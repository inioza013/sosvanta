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
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405 );

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

  let body: { payment_id?: string };
  try { body = await req.json(); } catch { return json({ error: "Format permintaan tidak valid." }, 400); }
  if (!body.payment_id) return json({ error: "payment_id wajib diisi." }, 400);

  const { data: payment, error: paymentError } = await admin.from("payments")
    .select("id,order_id,provider,provider_order_id,amount,status")
    .eq("id", body.payment_id).eq("provider", "midtrans").maybeSingle();
  if (paymentError || !payment) return json({ error: "Catatan pembayaran Midtrans tidak ditemukan." }, 404);
  if (!payment.provider_order_id) return json({ error: "Nomor transaksi Midtrans belum tersedia." }, 409);

  const apiBase = production ? "https://api.midtrans.com" : "https://api.sandbox.midtrans.com";
  const response = await fetch(apiBase + "/v2/" + encodeURIComponent(payment.provider_order_id) + "/status", {
    headers: { "Accept": "application/json", "Authorization": "Basic " + btoa(serverKey + ":") },
  });
  if (response.status === 404) {
    return json({
      payment_id: payment.id,
      provider_order_id: payment.provider_order_id,
      result: "not_found",
      message: "Transaksi tidak ditemukan pada akun Midtrans yang terhubung. Catatan database tidak diubah.",
      database_status: payment.status,
    });
  }
  if (!response.ok) return json({ error: "Midtrans Status API gagal merespons.", provider_http_status: response.status }, 502);

  const current = await response.json();
  const amount = Number(current.gross_amount);
  if (String(current.order_id ?? "") !== payment.provider_order_id || !Number.isFinite(amount) || amount !== Number(payment.amount)) {
    return json({ error: "Data transaksi dari Midtrans tidak cocok dengan catatan pembayaran. Database tidak diubah.", result: "mismatch" }, 409);
  }

  const tx = String(current.transaction_status ?? "");
  const fraud = String(current.fraud_status ?? "");
  let next = "pending";
  if (String(current.status_code ?? "") === "200" && (tx === "settlement" || tx === "capture") && (!current.fraud_status || fraud === "accept")) next = "paid";
  else if (tx === "expire") next = "expired";
  else if (tx === "cancel") next = "cancelled";
  else if (tx === "deny" || tx === "failure") next = "failed";
  else if (tx === "refund" || tx === "partial_refund") next = "refunded";

  const update: Record<string, unknown> = {
    status: next,
    raw_notification: {
      _checked_by: "admin-individual-midtrans-status-api",
      transaction_status: tx,
      status_code: current.status_code ?? null,
      transaction_id: current.transaction_id ?? null,
      payment_type: current.payment_type ?? null,
      checked_at: new Date().toISOString(),
    },
  };
  if (current.transaction_id) update.provider_reference = String(current.transaction_id);
  if (current.payment_type) update.payment_method = String(current.payment_type);
  if (next === "paid") update.paid_at = current.settlement_time || new Date().toISOString();

  const { error: updateError } = await admin.from("payments").update(update).eq("id", payment.id);
  if (updateError) return json({ error: "Status Midtrans terbaca, tetapi database gagal diperbarui." }, 500);

  if (next === "paid") {
    const { data: order } = await admin.from("orders").select("id,status").eq("id", payment.order_id).maybeSingle();
    if (order && order.status !== "paid") {
      const { error: orderError } = await admin.from("orders").update({ status: "paid" }).eq("id", order.id);
      if (orderError) return json({ error: "Pembayaran tercatat, tetapi status pesanan gagal diperbarui.", payment_status: next }, 500);
      await admin.from("order_events").insert({
        order_id: order.id, actor_id: userData.user.id, old_status: order.status, new_status: "paid",
        message: "Pembayaran Midtrans terverifikasi melalui pemeriksaan transaksi individual.",
        is_customer_visible: true,
      });
    }
  }

  return json({
    payment_id: payment.id,
    provider_order_id: payment.provider_order_id,
    result: next,
    transaction_status: tx,
    transaction_id: current.transaction_id ?? null,
    database_status: next,
    order_status: next === "paid" ? "paid" : "unchanged",
    message: "Hanya catatan pembayaran ini yang diperiksa dan diperbarui.",
  });
});
