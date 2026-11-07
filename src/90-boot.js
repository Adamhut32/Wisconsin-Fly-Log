
/* ---------- sign in ---------- */
let authMode = "in";
function setAuthMode(m){
  authMode = m;
  $("authInTab").setAttribute("aria-pressed", m === "in"); $("authUpTab").setAttribute("aria-pressed", m === "up");
  $("nameRow").hidden = m !== "up";
  $("pwRow").hidden = m === "reset";
  $("aEmail").closest(".field").hidden = m === "newpw";
  $("aPw").autocomplete = m === "in" ? "current-password" : "new-password";
  $("pwRow").querySelector("label").textContent = m === "newpw" ? "New password" : "Password";
  $("authGo").textContent = { in:"Sign in", up:"Create account", reset:"Send reset link", newpw:"Save new password" }[m];
  $("forgotBtn").hidden = m !== "in";
  $("stayRow").hidden = m === "reset" || m === "newpw";
  $("authMsg").textContent = ""; $("authMsg").className = "hint";
}
try{ $("aStay").checked = lsGet("fl.stay", true); }catch(e){}
$("pwShow").onclick = () => {
  const show = $("aPw").type === "password";
  $("aPw").type = show ? "text" : "password";
  $("pwShow").textContent = show ? "Hide" : "Show";
  $("pwShow").setAttribute("aria-pressed", String(show)); $("pwShow").setAttribute("aria-label", show ? "Hide password" : "Show password");
  $("aPw").focus({ preventScroll:true });
};
$("authInTab").onclick = () => setAuthMode("in");
$("authUpTab").onclick = () => setAuthMode("up");
$("forgotBtn").onclick = () => setAuthMode("reset");
$("authForm").addEventListener("submit", async e => {
  e.preventDefault();
  const msg = $("authMsg"), email = $("aEmail").value.trim(), pw = $("aPw").value, go = $("authGo");
  msg.className = "hint bad";
  if(authMode !== "newpw" && !/^\S+@\S+\.\S+$/.test(email)){ msg.textContent = "Enter your email address."; $("aEmail").focus(); return; }
  if(authMode !== "reset" && pw.length < 8){ msg.textContent = "Passwords need at least 8 characters."; $("aPw").focus(); return; }
  if(authMode === "up" && !$("aName").value.trim()){ msg.textContent = "Add your name so friends know who you are."; $("aName").focus(); return; }
  go.disabled = true;
  lsSet("fl.stay", $("aStay").checked);
  const redirect = location.origin + location.pathname;
  try{
    if(authMode === "in"){
      const { error } = await sb.auth.signInWithPassword({ email, password:pw });
      if(error) throw new Error(/confirm/i.test(error.message) ? "Confirm your email first. Check your inbox for the link." : "That email and password don't match.");
    } else if(authMode === "up"){
      const { data, error } = await sb.auth.signUp({ email, password:pw, options:{ data:{ display_name:$("aName").value.trim() }, emailRedirectTo:redirect } });
      if(error) throw new Error(/registered/i.test(error.message) ? "That email already has an account. Sign in instead." : error.message);
      if(!data.session){ setAuthMode("in"); $("aEmail").value = email; msg.className = "hint ok"; msg.textContent = "Check your email and tap the confirmation link, then sign in here."; }
    } else if(authMode === "reset"){
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo:redirect });
      if(error) throw new Error("Couldn't send the email. Wait a minute and try again.");
      msg.className = "hint ok"; msg.textContent = "Check your email for a link to set a new password.";
    } else {
      const { error } = await sb.auth.updateUser({ password:pw });
      if(error) throw new Error("Couldn't save the new password. Try again.");
      $("auth").hidden = true; toast("Password updated. You're signed in."); history.replaceState(null, "", location.pathname);
    }
  }catch(err){ msg.className = "hint bad"; msg.textContent = err.message || "Something went wrong. Try again."; }
  finally{ go.disabled = false; }
});

let recoveryShown = false;
function showNewPassword(){ if(recoveryShown) return; recoveryShown = true; $("auth").hidden = false; setAuthMode("newpw"); $("authMsg").className = "hint ok"; $("authMsg").textContent = "Choose a new password for your account."; }
async function startSession(user){
  if(RECOVERY_LINK) showNewPassword();
  if(me && me.id === user.id) return;
  me = { id:user.id, email:user.email };
  outbox = lsGet(outboxKey(), []);
  const cache = lsGet(cacheKey(), null);
  if(cache){ ({ catches, spots, trips, friendCatches, friendSpots, friendTrips, friendships, people, profile } = { ...cache }); follows = cache.follows || []; tournaments = cache.tournaments || []; announcements = cache.announcements || [];
    for(const j of outbox) if(j.photo){ idb.get(j.photo).then(b => { if(b){ pendingPhotoUrls[j.photo] = URL.createObjectURL(b); renderAll(); } }).catch(()=>{}); } }
  loadState = navigator.onLine ? "loading" : "offline";
  if(!recoveryShown) $("auth").hidden = true; canWrite = true;
  renderAll(); updateSync();
  await loadAll(); flush();
}
function showAuth(){ me = null; $("auth").hidden = false; setAuthMode("in"); }
sb.auth.onAuthStateChange((event, session) => {
  if(event === "PASSWORD_RECOVERY"){ showNewPassword(); if(session?.user) startSession(session.user); return; }
  if(session?.user) startSession(session.user);
  else if(event === "SIGNED_OUT") showAuth();
});

/* ---------- start ---------- */
tab = lsGet("fl.tab", "map");
renderAll();
const { data:{ session } } = await sb.auth.getSession();
if(session?.user) startSession(session.user);
else { showAuth(); if(LINK_ERROR){ $("authMsg").className = "hint bad"; $("authMsg").textContent = /expired|invalid/i.test(decodeURIComponent(LINK_ERROR)) ? "That email link has expired or was already used. Request a new one." : decodeURIComponent(LINK_ERROR.replace(/\+/g, " ")); } }

if("serviceWorker" in navigator){
  navigator.serviceWorker.register("sw.js").catch(e => console.warn("offline support unavailable", e));
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if(reloading) return;
    const busy = !$("scrim").hidden || !$("tripScrim").hidden || picking;
    if(!busy){ reloading = true; location.reload(); }
  });
}
})().catch(e => {
  console.error(e);
  document.body.insertAdjacentHTML("beforeend", `<div style="position:fixed;inset:auto 16px 16px;padding:12px 14px;border-radius:12px;background:#2C2922;color:#FAF6EB;z-index:3000;font:15px system-ui">The map couldn't start. Check your connection and reopen the app.</div>`);
});
