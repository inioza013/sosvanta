const menuToggle=document.getElementById("menuToggle");
const nav=document.getElementById("nav");
menuToggle.addEventListener("click",()=>{
  const open=nav.classList.toggle("open");
  menuToggle.setAttribute("aria-expanded",String(open));
});
nav.querySelectorAll("a").forEach(link=>link.addEventListener("click",()=>{
  nav.classList.remove("open");
  menuToggle.setAttribute("aria-expanded","false");
}));
document.getElementById("year").textContent=new Date().getFullYear();

// Public browser key: database access is restricted by Supabase Auth and RLS.
const SUPABASE_URL="https://ipfarmvctzymnmehzxws.supabase.co";
const SUPABASE_PUBLISHABLE_KEY="sb_publishable_oKBQncoYDB9Bz7MevZRLtA_Cb1ZTSPJ";
const supabaseClient=window.supabase.createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY);

const authEmail=document.getElementById("accountEmail");
const authPassword=document.getElementById("accountPassword");
const authStatus=document.getElementById("authStatus");
const signInButton=document.getElementById("signInButton");
const signUpButton=document.getElementById("signUpButton");
const signOutButton=document.getElementById("signOutButton");
let currentUser=null;

function showAuthStatus(message,isError=false){
  authStatus.textContent=message;
  authStatus.classList.toggle("is-error",isError);
}
function renderAuth(user){
  currentUser=user||null;
  signInButton.hidden=!!user;
  signUpButton.hidden=!!user;
  signOutButton.hidden=!user;
  authEmail.disabled=!!user;
  authPassword.disabled=!!user;
  if(user) showAuthStatus("Masuk sebagai "+user.email+". Anda dapat mengirim pesanan.");
}
async function loadSession(){
  const {data,error}=await supabaseClient.auth.getSession();
  if(error) showAuthStatus(error.message,true);
  renderAuth(data.session?.user||null);
}
signUpButton.addEventListener("click",async()=>{
  const email=authEmail.value.trim();
  const password=authPassword.value;
  if(!email||password.length<8){showAuthStatus("Masukkan email dan password minimal 8 karakter.",true);return;}
  signUpButton.disabled=true;
  showAuthStatus("Membuat akun...");
  const {data,error}=await supabaseClient.auth.signUp({
    email,password,
    options:{data:{full_name:document.getElementById("name").value.trim()}}
  });
  signUpButton.disabled=false;
  if(error){showAuthStatus(error.message,true);return;}
  if(data.session){renderAuth(data.user);showAuthStatus("Akun berhasil dibuat dan Anda sudah masuk.");}
  else showAuthStatus("Pendaftaran diterima. Periksa email untuk konfirmasi, lalu masuk di sini.");
});
signInButton.addEventListener("click",async()=>{
  const email=authEmail.value.trim();
  const password=authPassword.value;
  if(!email||!password){showAuthStatus("Masukkan email dan password.",true);return;}
  signInButton.disabled=true;
  showAuthStatus("Memeriksa akun...");
  const {data,error}=await supabaseClient.auth.signInWithPassword({email,password});
  signInButton.disabled=false;
  if(error){showAuthStatus(error.message,true);return;}
  renderAuth(data.user);
});
signOutButton.addEventListener("click",async()=>{
  const {error}=await supabaseClient.auth.signOut();
  if(error){showAuthStatus(error.message,true);return;}
  renderAuth(null);
  showAuthStatus("Anda sudah keluar. Masuk kembali untuk mengirim pesanan.");
});
supabaseClient.auth.onAuthStateChange((_event,session)=>renderAuth(session?.user||null));
loadSession();

const form=document.getElementById("briefForm");
const result=document.getElementById("briefResult");
const briefText=document.getElementById("briefText");
const copyStatus=document.getElementById("copyStatus");
let brief="";

form.addEventListener("submit",async event=>{
  event.preventDefault();
  if(!form.reportValidity()) return;
  if(!currentUser){showAuthStatus("Silakan masuk atau buat akun terlebih dahulu sebelum mengirim pesanan.",true);document.querySelector(".account-box").scrollIntoView({behavior:"smooth",block:"center"});return;}
  const data=new FormData(form);
  const customerName=String(data.get("name")).trim();
  const platform=String(data.get("platform"));
  const packageName=String(data.get("package"));
  const service=String(data.get("service"));
  const goal=String(data.get("goal")).trim();
  const orderNumber="SV-"+Date.now()+"-"+crypto.randomUUID().slice(0,8).toUpperCase();
  const orderBrief="Layanan: "+service+"\nTujuan: "+goal;
  const payload={
    order_number:orderNumber,
    customer_id:currentUser.id,
    package_name:packageName,
    platform,
    brand_name:customerName,
    customer_name:customerName,
    brief:orderBrief,
    status:"submitted"
  };
  const submitButton=form.querySelector(".submit-button");
  submitButton.disabled=true;
  submitButton.textContent="Menyimpan pesanan...";
  showAuthStatus("Menyimpan pesanan ke database...");
  const {data:order,error}=await supabaseClient.from("orders").insert(payload).select("order_number").single();
  submitButton.disabled=false;
  submitButton.innerHTML='Kirim brief via WhatsApp <span>↗</span>';
  if(error){
    showAuthStatus("Pesanan belum tersimpan: "+error.message+" Pastikan akun sudah terkonfirmasi dan kebijakan database aktif.",true);
    return;
  }
  brief=[
    "Halo SOSVANTA, saya ingin konsultasi layanan social media growth.",
    "",
    "NOMOR PESANAN: "+order.order_number,
    "BRIEF KONSULTASI SOSVANTA",
    "Nama/Brand: "+customerName,
    "Email akun: "+currentUser.email,
    "Platform: "+platform,
    "Paket/Harga: "+packageName,
    "Kebutuhan: "+service,
    "Tujuan: "+goal,
    "",
    "Mohon informasikan rekomendasi, ruang lingkup, estimasi waktu, dan penawaran biayanya."
  ].join("\n");
  briefText.textContent=brief;
  result.hidden=false;
  copyStatus.textContent="";
  showAuthStatus("Pesanan "+order.order_number+" berhasil disimpan. WhatsApp akan dibuka untuk tindak lanjut.");
  result.scrollIntoView({behavior:"smooth",block:"nearest"});
  const whatsappUrl="https://wa.me/62895328696545?text="+encodeURIComponent(brief);
  window.open(whatsappUrl,"_blank","noopener,noreferrer");
});

document.getElementById("copyBrief").addEventListener("click",async()=>{
  const status=document.getElementById("copyStatus");
  try{
    await navigator.clipboard.writeText(brief);
    status.textContent=" Brief berhasil disalin.";
  }catch(error){
    status.textContent=" Silakan salin teks brief secara manual.";
  }
});

document.querySelectorAll("[data-package]").forEach(button=>button.addEventListener("click",()=>{
  const packageSelect=document.getElementById("package");
  const option=[...packageSelect.options].find(item=>item.text===button.dataset.package);
  if(option) packageSelect.value=option.value;
  document.getElementById("mulai").scrollIntoView({behavior:"smooth"});
  packageSelect.focus({preventScroll:true});
}));
