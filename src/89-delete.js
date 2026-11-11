
/* ---------- delete my account (required by the App Store): removes the profile, all entries and photos ---------- */
$("log").addEventListener("click", async ev => {
  const a = ev.target.closest("[data-a]"); if(!a) return;
  const slot = $("log").querySelector("[data-delslot]");
  if(a.dataset.a === "delacct" && slot){
    slot.innerHTML = `<div class="card notice" style="margin-top:10px">
      <p><b>Delete your Coulee account?</b></p>
      <p>This permanently removes your profile, every catch, spot, trip, photo, message and forum post, your friends list and your tournament entries. It can't be undone.</p>
      <p class="muted">Want a copy first? Tap <b>Download a copy</b> above.</p>
      <label for="delConfirm">Type DELETE to confirm</label>
      <input id="delConfirm" autocomplete="off" autocapitalize="characters" spellcheck="false">
      <span class="hint" id="delMsg" role="alert"></span>
      <div class="row2" style="margin-top:8px"><button class="btn" type="button" data-a="delcancel">Keep my account</button><button class="btn danger" type="button" data-a="delgo">Delete forever</button></div></div>`;
    setTimeout(() => $("delConfirm")?.focus(), 50);
  }
  if(a.dataset.a === "delcancel" && slot) slot.innerHTML = "";
  if(a.dataset.a === "delgo"){
    const msg = $("delMsg");
    if(($("delConfirm").value || "").trim().toUpperCase() !== "DELETE"){ msg.className = "hint bad"; msg.textContent = "Type DELETE to confirm."; return; }
    if(!navigator.onLine){ msg.className = "hint bad"; msg.textContent = "You need a connection to delete your account."; return; }
    a.disabled = true; msg.className = "hint"; msg.textContent = "Deleting your photos…";
    try{
      // photos and avatar live in folders named after the account
      for(const bucket of ["photos", "avatars"]){
        for(let round = 0; round < 50; round++){
          const { data, error } = await sb.storage.from(bucket).list(me.id, { limit:1000 });
          if(error || !data || !data.length) break;
          const paths = data.filter(f => f.name).map(f => `${me.id}/${f.name}`);
          if(!paths.length) break;
          const rm = await sb.storage.from(bucket).remove(paths); if(rm.error) break;
        }
      }
      msg.textContent = "Deleting your account…";
      const { error } = await sb.rpc("delete_my_account", { confirm:"DELETE" });
      if(error) throw error;
      try{ const reg = await navigator.serviceWorker?.ready; const sub = await reg?.pushManager?.getSubscription(); if(sub) await sub.unsubscribe(); }catch(e){}
      try{ for(const k of Object.keys(localStorage)) if(k.startsWith("fl.")) localStorage.removeItem(k); indexedDB.deleteDatabase("flylog"); }catch(e){}
      await forgetPhotos(); await sb.auth.signOut().catch(() => {});
      document.body.innerHTML = `<div style="max-width:420px;margin:20vh auto;padding:24px;font:16px/1.5 system-ui;text-align:center"><h2 style="font-family:Georgia,serif">Your account is deleted</h2><p>Everything you logged in Coulee has been removed. Thanks for fishing with us.</p><p><a href="./">Back to Coulee</a></p></div>`;
    }catch(e){
      a.disabled = false; msg.className = "hint bad";
      msg.textContent = e && /founder|DELETE|Sign in/.test(e.message || "") ? e.message : "Couldn't delete your account. Check your connection and try again.";
    }
  }
});
