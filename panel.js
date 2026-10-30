const SUPABASE_URL="https://ipfarmvctzymnmehzxws.supabase.co";
const SUPABASE_PUBLISHABLE_KEY="sb_publishable_oKBQncoYDB9Bz7MevZRLtA_Cb1ZTSPJ";
const db=window.supabase.createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY);
const $=id=>document.getElementById(id);
const statusLabels={submitted:"Diterima",under_review:"Ditinjau",quoted:"Penawaran tersedia",awaiting_payment:"Menunggu pembayaran",paid:"Pembayaran diterima",in_progress:"Sedang dikerjakan",revision:"Revisi",completed:"Selesai",cancelled:"Dibatalkan",rejected:"Tidak dapat diproses"};
let currentUser=null,services=[];
function message(el,text,error=false){el.textContent=text;el.classList.toggle("error",error)}
function escapeHtml(value){return String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function rupiah(value){return new Intl.NumberFormat("id-ID",{style:"currency",currency:"IDR",maximumFractionDigits:0}).format(Number(value||0))}
async function loadCatalog(){
 const {data,error}=await db.from("services").select("id,slug,name,description,price,price_label,billing_type").eq("is_active",true).order("sort_order");
 if(error){$("services").innerHTML='<div class="empty">Katalog belum tersedia. Silakan hubungi admin SOSVANTA.</div>';return}
 services=data||[];
 $("services").innerHTML=services.map((s,i)=>'<article class="service"><span class="code">SERVICE / '+String(i+1).padStart(2,"0")+'</span><h3>'+escapeHtml(s.name)+'</h3><p>'+escapeHtml(s.description||"Layanan pemasaran digital SOSVANTA.")+'</p><div class="price">'+escapeHtml(s.price_label||"Penawaran khusus")+'</div><button class="secondary choose" data-service="'+escapeHtml(s.id)+'">Pilih layanan ↗</button></article>').join("")||'<div class="empty">Belum ada layanan aktif.</div>';
 $("serviceSelect").innerHTML='<option value="">Pilih layanan</option>'+services.map(s=>'<option value="'+escapeHtml(s.id)+'">'+escapeHtml(s.name)+' — '+escapeHtml(s.price_label||"Custom")+'</option>').join("");
 document.querySelectorAll(".choose").forEach(b=>b.addEventListener("click",()=>{$("serviceSelect").value=b.dataset.service;$("orderForm").scrollIntoView({behavior:"smooth",block:"center"})}));
}
async function refreshOrders(){
 if(!currentUser)return;
 $("refresh").disabled=true;
 const {data,error}=await db.from("orders").select("id,order_number,package_name,platform,brand_name,brief,status,submitted_at,quoted_amount,admin_notes").eq("customer_id",currentUser.id).order("created_at",{ascending:false}).limit(50);
 $("refresh").disabled=false;
 if(error){$("orderList").innerHTML='<div class="empty">Gagal memuat pesanan. Coba muat ulang.</div>';return}
 const rows=data||[];
 $("totalCount").textContent=rows.length;
 $("activeCount").textContent=rows.filter(o=>["submitted","under_review","quoted","awaiting_payment","paid","in_progress","revision"].includes(o.status)).length;
 $("orderList").innerHTML=rows.length?rows.map(o=>'<article class="order-card"><div class="order-top"><strong>'+escapeHtml(o.order_number)+'</strong><span class="pill">'+escapeHtml(statusLabels[o.status]||o.status)+'</span></div><p><b>'+escapeHtml(o.package_name||"Layanan custom")+'</b> · '+escapeHtml(o.platform||"-")+'</p><p>'+escapeHtml(o.brand_name||"")+' · '+new Date(o.submitted_at).toLocaleString("id-ID")+'</p><p>'+escapeHtml(o.brief||"")+'</p>'+(o.quoted_amount!=null?'<p><b>Penawaran: '+rupiah(o.quoted_amount)+'</b></p>':"")+(o.admin_notes?'<p>Catatan: '+escapeHtml(o.admin_notes)+'</p>':"")+'</article>').join(""):'<div class="empty">Belum ada pesanan. Pilih layanan dan kirim permintaan pertama Anda.</div>';
}
async function setSession(session){
 currentUser=session?.user||null;
 $("auth").hidden=!!currentUser;$("workspace").hidden=!currentUser;$("logout").hidden=!currentUser;
 $("userEmail").textContent=currentUser?.email||"Belum masuk";
 if(currentUser){await loadCatalog();await refreshOrders()}
}
$("authForm").addEventListener("submit",async e=>{e.preventDefault();const b=$("login");b.disabled=true;message($("authMessage"),"Memeriksa akun...");
 const {data,error}=await db.auth.signInWithPassword({email:$("email").value.trim(),password:$("password").value});
 b.disabled=false;if(error){message($("authMessage"),error.message,true);return}await setSession(data.session);
});
$("register").addEventListener("click",async()=>{const b=$("register");b.disabled=true;message($("authMessage"),"Membuat akun...");
 const {data,error}=await db.auth.signUp({email:$("email").value.trim(),password:$("password").value,options:{emailRedirectTo:location.origin+location.pathname}});
 b.disabled=false;if(error){message($("authMessage"),error.message,true);return}
 message($("authMessage"),data.session?"Akun berhasil dibuat. Anda sudah masuk.":"Pendaftaran berhasil. Periksa email untuk konfirmasi akun.");
 if(data.session)await setSession(data.session);
});
$("logout").addEventListener("click",async()=>{await db.auth.signOut();await setSession(null)});
$("refresh").addEventListener("click",refreshOrders);
$("orderForm").addEventListener("submit",async e=>{
 e.preventDefault();if(!currentUser){message($("orderMessage"),"Silakan masuk kembali.",true);return}
 const service=services.find(s=>s.id===$("serviceSelect").value);if(!service){message($("orderMessage"),"Pilih layanan yang tersedia.",true);return}
 const btn=$("submitOrder");btn.disabled=true;message($("orderMessage"),"Menyimpan permintaan...");
 const orderNumber="SV-"+Date.now()+"-"+crypto.randomUUID().slice(0,8).toUpperCase();
 const payload={order_number:orderNumber,customer_id:currentUser.id,service_id:service.id,package_name:service.name+" — "+(service.price_label||"Penawaran khusus"),platform:$("platform").value,brand_name:$("brand").value.trim(),customer_name:$("brand").value.trim(),brief:$("brief").value.trim(),status:"submitted"};
 const {error}=await db.from("orders").insert(payload);
 btn.disabled=false;
 if(error){message($("orderMessage"),"Belum berhasil menyimpan pesanan: "+error.message,true);return}
 message($("orderMessage"),"Permintaan "+orderNumber+" berhasil dikirim. Tim SOSVANTA akan meninjau dan menghubungi Anda.");
 $("orderForm").reset();await refreshOrders();$("orders").scrollIntoView({behavior:"smooth"});
});
$("year").textContent=new Date().getFullYear();
(async()=>{const {data}=await db.auth.getSession();await setSession(data.session);db.auth.onAuthStateChange((_event,session)=>{setSession(session)})})();
