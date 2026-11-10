
/* ---------- unique @usernames: everyone picks one; friends can find you by it ---------- */
function suggestUsername(){
  const base = (profile?.display_name || me?.email?.split("@")[0] || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "").slice(0, 16);
  return base.length >= 3 ? base : "";
}
let unameTimer = null, unameRequired = false;
function openUsername(required){
  unameRequired = !!required;
  $("unameTitle").textContent = profile?.username ? "Change your username" : "Pick your username";
  $("unameLater").hidden = unameRequired;
  $("unameIn").value = profile?.username || suggestUsername();
  $("unameMsg").className = "hint"; $("unameMsg").textContent = "3 to 20 letters, numbers, _ or .";
  $("unameScrim").hidden = false; setTimeout(() => { $("unameIn").focus(); checkUname(); }, 60);
}
function closeUsername(){ $("unameScrim").hidden = true; }
const cleanUname = v => v.toLowerCase().replace(/^@+/, "").replace(/\s+/g, "");
async function checkUname(){
  const v = cleanUname($("unameIn").value), msg = $("unameMsg");
  if(!v || v === profile?.username){ msg.className = "hint"; msg.textContent = "3 to 20 letters, numbers, _ or ."; return; }
  const { data, error } = await sb.rpc("username_check", { u:v });
  if(cleanUname($("unameIn").value) !== v || error) return;
  msg.className = data ? "hint bad" : "hint ok"; msg.textContent = data || `@${v} is available.`;
}
$("unameIn").addEventListener("input", () => {
  const el = $("unameIn"), v = cleanUname(el.value); if(v !== el.value) el.value = v;
  clearTimeout(unameTimer); unameTimer = setTimeout(checkUname, 350);
});
$("unameLater").onclick = closeUsername;
$("unameScrim").addEventListener("click", e => { if(e.target === $("unameScrim") && !unameRequired) closeUsername(); });
$("unameForm").addEventListener("submit", async e => {
  e.preventDefault(); const v = cleanUname($("unameIn").value), msg = $("unameMsg"), btn = $("unameSave");
  if(v === profile?.username){ closeUsername(); return; }
  btn.disabled = true;
  const { data, error } = await sb.rpc("set_username", { u:v });
  btn.disabled = false;
  if(error){ msg.className = "hint bad"; msg.textContent = /taken|reserved|Use |Start|period|Pick/.test(error.message) ? error.message : "Couldn't save it. Check your connection and try again."; return; }
  profile = { ...profile, username:data }; saveCache(); closeUsername(); toast(`You're @${data}`); renderLog();
});
document.addEventListener("click", e => { if(e.target.closest('[data-a="uname"]')) openUsername(false); });
// existing accounts pick one the next time the app opens (after the What's new / setup screens are out of the way)
let unameAsked = false;
setInterval(() => {
  if(unameAsked || !me || !profile || profile.username || profile.status !== "approved" || !navigator.onLine) return;
  if([...document.querySelectorAll(".scrim")].some(s => !s.hidden)) return;
  unameAsked = true; openUsername(true);
}, 2000);
