
/* ---------- photo fingerprints: a 64-bit "difference hash" that survives resizing and re-saving ---------- */
async function dhash(blob){
  let bmp; try{ bmp = await createImageBitmap(blob); }catch(e){ bmp = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(blob); }); }
  const cv = document.createElement("canvas"); cv.width = 9; cv.height = 8;
  const g = cv.getContext("2d", { willReadFrequently:true }); g.drawImage(bmp, 0, 0, 9, 8);
  const d = g.getImageData(0, 0, 9, 8).data, lum = i => d[i] * .299 + d[i + 1] * .587 + d[i + 2] * .114;
  let bits = "";
  for(let y = 0; y < 8; y++) for(let x = 0; x < 8; x++) bits += lum((y * 9 + x) * 4) > lum((y * 9 + x + 1) * 4) ? "1" : "0";
  let hex = ""; for(let i = 0; i < 64; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  return hex;
}
const kmBetween = (a, b) => { const k = Math.PI / 180, dLat = (b.lat - a.lat) * k, dLng = (b.lng - a.lng) * k;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * k) * Math.cos(b.lat * k) * Math.sin(dLng / 2) ** 2; return 12742 * Math.asin(Math.sqrt(h)); };
// what the photo itself says, compared with what was logged (only distances and dates are kept, never the photo's coordinates)
function photoMeta(ex, entry){
  const gps = !!(ex && ex.lat != null), date = ex && ex.date ? (ex.date.match(/^(\d{4}):(\d{2}):(\d{2})/) || []).slice(1).join("-") || null : null;
  return { has_exif: !!(gps || date), gps, photo_date: date,
    km_from_entry: gps && entry ? Math.round(kmBetween({ lat:ex.lat, lng:ex.lng }, entry) * 10) / 10 : null };
}
// older photos get a fingerprint in the background, a few at a time
let backfilling = false;
async function backfillHashes(){
  if(backfilling || !navigator.onLine || !me) return; backfilling = true;
  try{
    const todo = catches.filter(c => c.photo_path && !c.photo_hash && !c._pending && !pendingPhotoUrls[c.photo_path]).slice(0, 8);
    for(const c of todo){
      const { data, error } = await sb.storage.from("photos").download(c.photo_path); if(error || !data) continue;
      const h = await dhash(data);
      const u = await sb.from("catches").update({ photo_hash:h }).eq("id", c.id);
      if(!u.error) c.photo_hash = h;
    }
    if(todo.length) saveCache();
  }catch(e){ console.warn("fingerprints", e); } finally { backfilling = false; }
}
function touchActive(){
  const d = todayStr(); if(lsGet("fl.active", "") === d) return;
  sb.rpc("touch_active").then(({ error }) => { if(!error) lsSet("fl.active", d); });
}

/* ---------- review queue (founder and admins) ---------- */
const FLAG_LABEL = { duplicate:"Same photo as another catch", no_camera_data:"No camera data", location_mismatch:"Photo taken elsewhere", date_mismatch:"Photo date doesn't match" };
let flagList = null, flagCount = 0, flagShowAll = false;
async function loadFlags(){
  if(!isStaff()) return;
  const { data, error } = await sb.rpc("flag_queue", { show: flagShowAll ? "all" : "open" });
  if(error) return;
  flagList = data || [];
  if(!flagShowAll) flagCount = flagList.length;
  $("meDot").hidden = !(pendingCount || flagCount);
  if(tab === "me") renderLog();
}
function flagQueueHtml(){
  if(!flagList){ loadFlags(); return `<h4><span>Fair play review</span></h4><p class="status">Loading…</p>`; }
  const byCatch = {}; flagList.forEach(f => (byCatch[f.catch_id] ||= []).push(f));
  const groups = Object.values(byCatch);
  return `<h4><span>Fair play review</span><span>${flagCount} open</span></h4>
    <p class="muted" style="margin:0 0 8px;font-size:13.5px">Flags are hints, not proof. Phones sometimes drop photo data, and friends sometimes share one photo. Look before you hide anything.</p>
    <div class="row2" style="margin-bottom:8px"><label class="check" style="margin:0"><input type="checkbox" id="flagAll" ${flagShowAll ? "checked" : ""}> Show reviewed flags too</label></div>
    ${groups.length ? `<div class="stack">${groups.map(fs => { const f = fs[0], open = fs.some(x => x.status === "open");
      return `<div class="card flag${open ? "" : " done"}">
        <p class="muted" style="font-size:12.5px;margin:0">${esc(f.display_name)} · ${esc(f.species || "Fish")}${f.length_in ? ` · ${lenTxt(f.length_in)}` : ""} · ${esc(fmtDate(f.caught_on))} · ${esc(countyName(f.county))}${f.tournaments?.length ? ` · <b>In ${esc(f.tournaments.join(", "))}</b>` : ""}</p>
        <div class="flagpics">${f.photo_path ? `<figure>${phImg(f.photo_path, 'alt="Flagged photo" loading="lazy"')}<figcaption>This catch</figcaption></figure>` : ""}
          ${f.other_photo ? `<figure>${phImg(f.other_photo, 'alt="Matching photo" loading="lazy"')}<figcaption>Match: ${esc(f.other_name || "")}</figcaption></figure>` : ""}</div>
        <ul class="flagwhy">${fs.map(x => `<li><b>${esc(FLAG_LABEL[x.kind] || x.kind)}</b> ${esc(x.detail || "")}${x.status !== "open" ? ` <span class="pill ${x.status === "upheld" ? "priv" : "fished"}">${x.status === "upheld" ? "Hidden" : "Cleared"}</span>` : ""}</li>`).join("")}</ul>
        ${open ? `<div class="row2"><button class="btn sm" type="button" data-flagok="${esc(f.id)}">Looks fine</button><button class="btn sm" type="button" data-flaghide="${esc(f.id)}">Hide this catch…</button></div><div data-flagslot="${esc(f.id)}"></div>` : ""}</div>`; }).join("")}</div>`
      : `<p class="muted">Nothing to review. Every photo checks out.</p>`}`;
}
$("log").addEventListener("change", e => { if(e.target.id === "flagAll"){ flagShowAll = e.target.checked; flagList = null; renderLog(); } });
$("log").addEventListener("click", async e => {
  const ok = e.target.closest("[data-flagok]"), hide = e.target.closest("[data-flaghide]"), yes = e.target.closest("[data-flaghideyes]");
  if(hide){ const slot = $("log").querySelector(`[data-flagslot="${hide.dataset.flaghide}"]`);
    slot.innerHTML = `<div class="card" style="margin-top:8px"><div class="field"><label>Reason the angler will see</label><input data-flagnote maxlength="200" placeholder="Same photo as an earlier catch"></div>
      <p class="muted" style="font-size:13px">Hiding removes it from feeds, leaderboards and tournaments. It stays in their own log, and they get a notice.</p>
      <div class="row2"><button class="btn sm ink" type="button" data-flaghideyes="${esc(hide.dataset.flaghide)}">Hide catch</button></div></div>`; return; }
  if(!ok && !yes) return;
  const id = (ok || yes).dataset[ok ? "flagok" : "flaghideyes"]; (ok || yes).disabled = true;
  const note = yes ? yes.closest(".card").querySelector("[data-flagnote]")?.value.trim() || null : null;
  const { error } = await sb.rpc("review_flag", { fid:id, verdict: ok ? "cleared" : "upheld", note });
  toast(error ? (error.message || "Couldn't save.") : ok ? "Cleared." : "Hidden. The angler was told.");
  flagList = null; loadFlags();
});

/* ---------- tournament creators see flags on their entries ---------- */
let tourneyFlags = {};
async function loadTourneyFlags(t){
  if(!t || !(t.owner === me?.id || isStaff())) return;
  const { data, error } = await sb.rpc("tournament_flags", { tid:t.id });
  if(error) return;
  tourneyFlags[t.id] = {}; (data || []).forEach(f => (tourneyFlags[t.id][f.catch_id] ||= []).push(f));
  if(tourneyOpen === t.id && tab === "tourney") renderLog();
}
function entryFlagHtml(tid, cid){
  const fs = tourneyFlags[tid]?.[cid]; if(!fs || !fs.length) return "";
  return ` <span class="pill flagpill" title="${esc(fs.map(f => (FLAG_LABEL[f.kind] || f.kind) + ": " + (f.detail || "")).join("\n"))}">⚑ ${esc(FLAG_LABEL[fs[0].kind] || "Flagged")}${fs.length > 1 ? ` +${fs.length - 1}` : ""}</span>`;
}

/* ---------- founder analytics: totals and trends only, never who did what ---------- */
let statsData = null;
async function loadFounderStats(){ const { data, error } = await sb.rpc("founder_stats"); statsData = error ? { error:true } : data; if(tab === "me" && meView === "analytics") renderLog(); }
function barsSvg(vals, labels, { h = 110, color = "var(--spot)", every = 1 } = {}){
  const W = 320, n = vals.length, bw = W / n, max = Math.max(1, ...vals);
  return `<svg class="chart" viewBox="0 0 ${W} ${h + 18}" role="img"><line x1="0" y1="${h}" x2="${W}" y2="${h}" stroke="var(--line)"/>
    ${vals.map((v, i) => { const bh = Math.round(v / max * (h - 14)); return `<rect x="${i * bw + 1.5}" y="${h - bh}" width="${Math.max(1, bw - 3)}" height="${bh}" rx="1.5" fill="${v ? color : "var(--line)"}"><title>${esc(labels[i])}: ${v}</title></rect>${v && n <= 14 ? `<text x="${i * bw + bw / 2}" y="${h - bh - 3}" text-anchor="middle">${v}</text>` : ""}${i % every === 0 ? `<text x="${i * bw + bw / 2}" y="${h + 13}" text-anchor="middle">${esc(labels[i])}</text>` : ""}`; }).join("")}</svg>`;
}
function rankTable(rows, head){ return rows.length ? `<table class="tbl"><thead><tr><th>${head}</th><th class="n">Fish</th></tr></thead><tbody>${rows.map(([k, n]) => `<tr><td>${esc(k)}</td><td class="n">${n}</td></tr>`).join("")}</tbody></table>` : `<p class="muted">No data yet.</p>`; }
function renderAnalytics(el){
  const back = `<button class="link backlink" data-me="creator" type="button">${icon("i-back")}Founder tools</button><div class="eyebrow">Founder</div><h2>Analytics</h2>`;
  if(!statsData){ el.innerHTML = back + `<p class="status">Counting…</p>`; loadFounderStats(); return; }
  if(statsData.error){ el.innerHTML = back + `<p class="muted">Couldn't load analytics. Try again.</p>`; return; }
  const s = statsData, a = s.accounts || {}, t = s.totals || {}, tn = s.tournaments || {};
  const day = s.active_days || [], wk = s.signups_weeks || [], mo = s.catches_months || [], tm = s.tournament_months || [];
  const md = d => { const x = new Date(d + "T12:00:00"); return `${x.getMonth() + 1}/${x.getDate()}`; }, mon = m => MON[+m.slice(5, 7) - 1];
  el.innerHTML = back + `<p class="muted" style="margin:0 0 10px">Totals and trends only. Nothing here shows who did what or where anyone fishes.</p>
    <div class="stats four"><div class="stat"><b>${a.approved ?? 0}</b><span>anglers</span></div><div class="stat"><b>${s.active_7 ?? 0}</b><span>active this week</span></div><div class="stat"><b>${s.active_30 ?? 0}</b><span>active this month</span></div><div class="stat"><b>${a.pending ?? 0}</b><span>waiting</span></div></div>
    <div class="stats four"><div class="stat f"><b>${t.fish ?? 0}</b><span>fish logged</span></div><div class="stat"><b>${t.photos ?? 0}</b><span>photos</span></div><div class="stat"><b>${s.trips ?? 0}</b><span>trips</span></div><div class="stat"><b>${s.flags_open ?? 0}</b><span>open flags</span></div></div>
    <h4><span>People opening the app</span><span>last 30 days</span></h4>${barsSvg(day.map(x => x[1]), day.map(x => md(x[0])), { every:5 })}
    <h4><span>New accounts</span><span>by week</span></h4>${barsSvg(wk.map(x => x[1]), wk.map(x => md(x[0])), { every:2, color:"var(--friend)" })}
    <h4><span>Fish caught</span><span>by month</span></h4>${barsSvg(mo.map(x => x[1]), mo.map(x => mon(x[0])), { color:"var(--fish)" })}
    <h4><span>When catches get logged</span><span>hour of day</span></h4>${barsSvg(s.catch_hours || [], Array.from({ length:24 }, (_, h) => h === 0 ? "12a" : h < 12 ? h + "a" : h === 12 ? "12p" : (h - 12) + "p"), { every:3 })}
    <h4><span>Busiest days</span></h4>${barsSvg(s.catch_weekdays || [], ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"])}
    <h4><span>Tournaments</span><span>${tn.total ?? 0} total</span></h4>
    <p style="margin:0 0 6px">${tn.live ?? 0} live · ${tn.upcoming ?? 0} upcoming · ${tn.finished ?? 0} finished · ${tn.open ?? 0} open to everyone · ${tn.entries ?? 0} entries</p>
    ${barsSvg(tm.map(x => x[1]), tm.map(x => mon(x[0])), { h:80, color:"var(--t2)" })}
    <h4><span>Top species</span></h4>${rankTable(s.species || [], "Species")}
    <h4><span>Methods</span></h4>${rankTable((s.methods || []).map(([m, n]) => [METHODS[m] || m, n]), "Method")}
    <h4><span>Busiest counties</span></h4>${rankTable((s.counties || []).map(([c, n]) => [countyName(c), n]), "County")}
    <p class="note">${a.public ?? 0} public profiles · ${a.with_picture ?? 0} with a picture · ${s.friendships ?? 0} friendships · ${s.spots ?? 0} spots · ${t.outside_wi ?? 0} catches outside Wisconsin. "Active" counts anyone who opened the app that day, once.</p>`;
}

/* ---------- suggestion triage labels ---------- */
const SUG_CAT = { bug:"Bug", idea:"Idea", question:"Question", other:"Other" };
function triageHtml(s){ return s.category || s.triage_note ? `<p class="triage">${s.category ? `<span class="pill ${s.category === "bug" ? "want" : "scouted"}">${SUG_CAT[s.category]}</span> ` : ""}${s.triage_note ? esc(s.triage_note) : ""}</p>` : ""; }
