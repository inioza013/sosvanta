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
  if (!authHeader?.startsWith("Bearer ")) return json({ error: "Login diperlukan." }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const serverKey = Deno.env.get("MIDTRANS_SERVER_KEY");
  const production = Deno.env.get("MIDTRANS_IS_PRODUCTION") === "true";
  if (!supabaseUrl || !anonKey || !serviceKey || !serverKey) {
    return json({ error: "Konfigurasi backend belum lengkap." }, 503);
  }

  const authClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: authError } = await authClient.auth.getUser();
  if (authError || !userData.user) return json({ error: "Sesi login tidak valid." }, 401);

  let body: { order_id?: string };
  try { body = await req.json(); } catch { return json({ error: "Format permintaan tidak valid." }, 400); }
  if (!body.order_id || typeof body.order_id !== "string") return json({ error: "order_id wajib diisi." }, 400);

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: order, error: orderError } = await admin
    .from("orders")
    .select("id,order_number,customer_id,customer_name,customer_phone,quoted_amount,currency,status")
    .eq("id", body.order_id)
    .maybeSingle();
  if (orderError) return json({ error: "Gagal membaca pesanan." }, 500);
  if (!order || order.customer_id !== userData.user.id) return json({ error: "Pesanan tidak ditemukan." }, 404);
  if (order.status !== "awaiting_payment") return json({ error: "Pesanan belum disetujui admin untuk dibayar." }, 409);

  const amount = Number(order.quoted_amount);
  if (!Number.isSafeInteger(amount) || amount < 1 || order.currency !== "IDR") {
    return json({ error: "Nominal penawaran belum valid. Hubungi admin SOSVANTA." }, 409);
  }

  const providerOrderId = "SV-" + crypto.randomUUID();
  const { data: payment, error: paymentError } = await admin.from("payments").insert({
    order_id: order.id,
    provider: "midtrans",
    provider_order_id: providerOrderId,
    amount,
    currency: "IDR",
    status: "pending",
  }).select("id").single();
  if (paymentError || !payment) return json({ error: "Tidak dapat menyiapkan catatan pembayaran." }, 500);

  const endpoint = production
    ? "https://app.midtrans.com/snap/v1/transactions"
    : "https://app.sandbox.midtrans.com/snap/v1/transactions";
  const basic = btoa(serverKey + ":");
  const snapResponse = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json",
      "Authorization": "Basic " + basic,
    },
    body: JSON.stringify({
      transaction_details: { order_id: providerOrderId, gross_amount: amount },
      customer_details: {
        first_name: String(order.customer_name || "Pelanggan SOSVANTA").slice(0, 50),
        email: userData.user.email,
        phone: order.customer_phone || undefined,
      },
      item_details: [{
        id: order.id,
        price: amount,
        quantity: 1,
        name: String(order.order_number + " - " + (order.customer_name || "Layanan SOSVANTA")).slice(0, 50),
      }],
      callbacks: {
        finish: "https://inioza013.github.io/sosvanta/#mulai",
      },
    }),
  });

  const snap = await snapResponse.json().catch(() => ({}));
  if (!snapResponse.ok || !snap.token || !snap.redirect_url) {
    await admin.from("payments").delete().eq("id", payment.id);
    return json({ error: "Midtrans belum dapat membuat tagihan. Silakan hubungi admin." }, 502);
  }

  const { error: saveError } = await admin.from("payments").update({
    snap_token: snap.token,
    redirect_url: snap.redirect_url,
  }).eq("id", payment.id);
  if (saveError) return json({ error: "Tagihan dibuat tetapi gagal disimpan. Hubungi admin." }, 500);

  return json({ payment_url: snap.redirect_url, snap_token: snap.token, order_number: order.order_number });
});
