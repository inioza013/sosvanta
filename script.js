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

const form=document.getElementById("briefForm");
const result=document.getElementById("briefResult");
const briefText=document.getElementById("briefText");
const copyStatus=document.getElementById("copyStatus");
let brief="";

form.addEventListener("submit",event=>{
  event.preventDefault();
  if(!form.reportValidity()) return;
  const data=new FormData(form);
  brief=[
    "Halo SOSVANTA, saya ingin konsultasi layanan social media growth.",
    "",
    "BRIEF KONSULTASI SOSVANTA",
    "Nama/Brand: "+data.get("name"),
    "Platform: "+data.get("platform"),
    "Kebutuhan: "+data.get("service"),
    "Tujuan: "+data.get("goal"),
    "",
    "Mohon informasikan rekomendasi, ruang lingkup, estimasi waktu, dan penawaran biayanya."
  ].join("\n");
  briefText.textContent=brief;
  result.hidden=false;
  copyStatus.textContent="";
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