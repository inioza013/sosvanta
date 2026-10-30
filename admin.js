const SUPABASE_URL="https://ipfarmvctzymnmehzxws.supabase.co";
const SUPABASE_PUBLISHABLE_KEY="sb_publishable_oKBQncoYDB9Bz7MevZRLtA_Cb1ZTSPJ";
const db=window.supabase.createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY);
const $=id=>document.getElementById(id);
const labels={submitted:"Pesanan diterima",under_review:"Sedang ditinjau",quoted:"Penawaran dikirim",awaiting_payment:"Menunggu pembayaran",paid:"Pembayaran diterima",in_progress:"Sedang dikerjakan",revision:"Menunggu revisi",completed:"Selesai",cancelled:"Dibatalkan",rejected:"Ditolak"};
const statuses=Object.keys(labels);let user=null,orders=[],services=[];
function esc(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function money(v){return new Intl.NumberFormat("id-ID",{style:"currency",currency:"IDR",maximumFractionDigits:0}).format(Number(v||0))}
function msg(el,text,error=false){el.textContent=text;el.classList.toggle("error",error)}
function date(v){return v?new Intl.DateTimeFormat("id-ID",{dateStyle:"medium",timeStyle:"short"}).format(new Date(v)):"-"}
function showLogin(){ $("loginPanel").hidden=false;$("adminApp").hidden=true;$("accessDenied").hidden=true;$("adminEmail").textContent="Belum masuk";$("logout").hidden=true}
async function checkAccess(){
 const {data,error}=await db.auth.getSession();if(error){showLogin();msg($("loginMessage"),error.message,true);return}
 user=data.session?.user||null;if(!user){showLogin();return}
 $("adminEmail").textContent=user.email;$("logout").hidden=false;
 const {data:profile,error:profileError}=await db.from("profiles").select("role").eq("id",user.id).single();
 if(profileError||profile?.role!=="admin"){$("loginPanel").hidden=true;$("adminApp").hidden=true;$("accessDenied").hidden=false;return}
 $("loginPanel").hidden=true;$("accessDenied").hidden=true;$("adminApp").hidden=false;
 await Promise.all([loadOrders(),loadServices()]);
}
$("loginForm").addEventListener("submit",async e=>{e.preventDefault();const b=e.submitter;b.disabled=true;msg($("loginMessage"),"Memeriksa akun...");
 const {error}=await db.auth.signInWithPassword({email:$("email").value.trim(),password:$("password").value});b.disabled=false;
 if(error){msg($("loginMessage"),error.message,true);return}await checkAccess();
});
$("logout").addEventListener("click",async()=>{await db.auth.signOut();user=null;showLogin()});
db.auth.onAuthStateChange((_event,session)=>{if(!session){user=null;showLogin()}});
async function loadOrders(){
 $("orders").innerHTML='<div class="empty">Memuat data pesanan...</div>';
 const {data,error}=await db.from("orders").select("id,order_number,customer_id,service_id,package_name,platform,brand_name,customer_name,customer_phone,brief,status,submitted_at,created_at,admin_notes,quoted_amount,currency").order("created_at",{ascending:false}).limit(250);
 if(error){$("orders").innerHTML='<div class="empty">Tidak dapat memuat pesanan: '+esc(error.message)+'</div>';return}
 orders=data||[];
 const ids=[...new Set(orders.map(o=>o.customer_id))];let profiles={};
 if(ids.length){const {data:rows}=await db.from("profiles").select("id,full_name,phone").in("id",ids);for(const p of rows||[])profiles[p.id]=p}
 orders=orders.map(o=>({...o,profile:profiles[o.customer_id]||{}}));
 $("metricTotal").textContent=orders.length;$("metricReview").textContent=orders.filter(o=>["submitted","under_review"].includes(o.status)).length;$("metricProgress").textContent=orders.filter(o=>["paid","in_progress","revision"].includes(o.status)).length;$("metricDone").textContent=orders.filter(o=>o.status==="completed").length;
 renderOrders();
}
function renderOrders(){
 const query=$("search").value.trim().toLowerCase(),filter=$("statusFilter").value;
 const shown=orders.filter(o=>(!filter||o.status===filter)&&(!query||[o.order_number,o.brand_name,o.customer_name,o.profile.full_name,o.profile.phone,o.platform,o.brief].some(v=>String(v||"").toLowerCase().includes(query))));
 if(!shown.length){$("orders").innerHTML='<div class="empty">Tidak ada pesanan yang cocok dengan filter.</div>';return}
 $("orders").innerHTML=shown.map(o=>{
 const opts=statuses.filter(s=>s!=="paid").map(s=>'<option value="'+s+'" '+(o.status===s?"selected":"")+'>'+labels[s]+'</option>').join("");
 return '<article class="order-card" data-card="'+esc(o.id)+'"><div class="order-head"><strong>'+esc(o.order_number)+'</strong><span class="pill">'+esc(labels[o.status]||o.status)+'</span></div><p class="order-meta"><b>'+esc(o.customer_name||o.profile.full_name||"Pelanggan")+'</b> · '+esc(o.profile.phone||o.customer_phone||"No. telepon belum ada")+' · '+esc(o.platform||"-")+'</p><p class="order-meta">'+esc(o.package_name||"Layanan custom")+' · '+esc(date(o.submitted_at))+'</p><div class="order-brief">'+esc(o.brief)+'</div><div class="order-grid"><label>Status<select data-status="'+esc(o.id)+'">'+opts+'</select></label><label>Penawaran (Rupiah)<input data-quote="'+esc(o.id)+'" type="number" min="1" step="1" value="'+(o.quoted_amount??"")+'" placeholder="Nominal Rupiah"></label><label class="wide">Catatan untuk pelanggan<textarea data-note="'+esc(o.id)+'" rows="2" maxlength="2000">'+esc(o.admin_notes||"")+'</textarea></label></div><div class="order-actions"><button class="primary" data-save="'+esc(o.id)+'">Simpan perubahan</button>'+(o.status==="awaiting_payment"||o.status==="paid"?'<button class="secondary" data-payment="'+esc(o.id)+'">Periksa pembayaran Midtrans</button>':"")+'</div><div class="history">Dikirim: '+esc(date(o.created_at))+' · ID pelanggan: '+esc(o.customer_id)+'</div></article>';
 }).join("");
 document.querySelectorAll("[data-save]").forEach(b=>b.addEventListener("click",()=>saveOrder(b.dataset.save,b)));
 document.querySelectorAll("[data-payment]").forEach(b=>b.addEventListener("click",()=>checkPayment(b.dataset.payment,b)));
}
async function saveOrder(id,button){
 const old=orders.find(o=>o.id===id);if(!old)return;
 const status=$('orders').querySelector('[data-status="'+id+'"]').value;
 const raw=$('orders').querySelector('[data-quote="'+id+'"]').value.trim();
 const quote=raw===""?null:Number(raw),note=$('orders').querySelector('[data-note="'+id+'"]').value.trim();
 if(raw!==""&&(!Number.isSafeInteger(quote)||quote<1)){alert("Nominal penawaran harus berupa angka Rupiah bulat lebih dari 0.");return}
 if(status==="awaiting_payment"&&(!Number.isSafeInteger(quote)||quote<1)){alert("Masukkan nominal penawaran sebelum mengirim instruksi pembayaran.");return}
 if(status==="paid"&&old.status!=="paid"){alert("Status pembayaran tidak dapat ditetapkan manual. Gunakan pemeriksaan Midtrans.");return}
 if(status==="paid")return;
 button.disabled=true;button.textContent="Menyimpan...";
 const {error}=await db.from("orders").update({status,quoted_amount:quote,admin_notes:note}).eq("id",id);
 if(error){button.disabled=false;button.textContent="Simpan perubahan";alert("Gagal menyimpan: "+error.message);return}
 if(status!==old.status||note!==old.admin_notes){
  const eventMessage=note!==old.admin_notes?note:"Status diperbarui menjadi "+labels[status];
  const {error:eventError}=await db.from("order_events").insert({order_id:id,actor_id:user.id,old_status:old.status,new_status:status,message:eventMessage,is_customer_visible:true});
  if(eventError)alert("Perubahan pesanan tersimpan, tetapi catatan riwayat gagal ditambahkan: "+eventError.message);
 }
 await loadOrders();
}
async function checkPayment(id,button){
 if(!confirm("Periksa status transaksi pesanan ini langsung ke Midtrans?"))return;
 const {data:rows,error:readError}=await db.from("payments").select("id,status,provider_order_id").eq("order_id",id).eq("provider","midtrans").order("created_at",{ascending:false});
 if(readError){alert("Tidak dapat membaca catatan pembayaran: "+readError.message);return}
 if(!rows?.length){alert("Belum ada transaksi Midtrans untuk pesanan ini.");return}
 button.disabled=true;button.textContent="Memeriksa...";
 const results=[];
 for(const p of rows){const {data,error}=await db.functions.invoke("midtrans-check-payment",{body:{payment_id:p.id}});results.push(error?(p.provider_order_id+": "+error.message):(p.provider_order_id+": "+(data?.result||data?.message||"diperiksa")))}
 button.disabled=false;alert("Hasil pemeriksaan:\n"+results.join("\n"));await loadOrders();
}
async function loadServices(){
 const {data,error}=await db.from("services").select("id,slug,name,description,price,price_label,billing_type,is_active,sort_order").order("sort_order");
 if(error){$("serviceList").innerHTML='<div class="empty">Gagal memuat katalog: '+esc(error.message)+'</div>';return}
 services=data||[];
 $("serviceList").innerHTML=services.map(s=>'<article class="service-row"><div><strong>'+esc(s.name)+'</strong><p>'+esc(s.description||"")+' · '+esc(s.slug)+'</p></div><div class="right">'+esc(s.price_label||"Harga custom")+'<br>'+ (s.is_active?"Aktif":"Nonaktif")+'</div><button class="secondary" data-toggle="'+esc(s.id)+'" data-active="'+String(s.is_active)+'">'+(s.is_active?"Nonaktifkan":"Aktifkan")+'</button></article>').join("")||'<div class="empty">Belum ada layanan.</div>';
 document.querySelectorAll("[data-toggle]").forEach(b=>b.addEventListener("click",()=>toggleService(b.dataset.toggle,b.dataset.active==="true",b)));
}
$("serviceForm").addEventListener("submit",async e=>{
 e.preventDefault();const btn=e.submitter;btn.disabled=true;msg($("serviceMessage"),"Menyimpan layanan...");
 const raw=$("servicePrice").value.trim(),price=raw===""?null:Number(raw);
 if(raw!==""&&(!Number.isSafeInteger(price)||price<0)){btn.disabled=false;msg($("serviceMessage"),"Harga harus berupa angka Rupiah bulat.",true);return}
 const payload={name:$("serviceName").value.trim(),slug:$("serviceSlug").value.trim().toLowerCase().replace(/[^a-z0-9-]/g,"-"),price,price_label:$("servicePriceLabel").value.trim()||"Penawaran khusus",billing_type:$("billing").value,sort_order:Number($("sortOrder").value)||100,description:$("serviceDescription").value.trim(),is_active:true};
 const {error}=await db.from("services").insert(payload);btn.disabled=false;
 if(error){msg($("serviceMessage"),"Gagal menambah layanan: "+error.message,true);return}
 $("serviceForm").reset();$("sortOrder").value="100";msg($("serviceMessage"),"Layanan berhasil ditambahkan.");await loadServices();
});
async function toggleService(id,active,button){
 button.disabled=true;const {error}=await db.from("services").update({is_active:!active}).eq("id",id);button.disabled=false;
 if(error){alert("Gagal mengubah status layanan: "+error.message);return}await loadServices();
}
$("refresh").addEventListener("click",()=>Promise.all([loadOrders(),loadServices()]));
$("search").addEventListener("input",renderOrders);$("statusFilter").addEventListener("change",renderOrders);
$("year").textContent=new Date().getFullYear();checkAccess();
