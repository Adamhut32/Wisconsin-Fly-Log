
/* ---------- weight ---------- */
function parseWeight(v){
  v = String(v || "").trim().toLowerCase(); if(!v) return null;
  let m = v.match(/^(\d+(?:\.\d+)?)\s*(?:lb|lbs|pounds?|#)?\s*(?:,|and)?\s*(?:(\d+(?:\.\d+)?)\s*(?:oz|ounces?))?$/);
  if(m && (m[2] || /lb|#|pound/.test(v) || !/oz/.test(v))) return Math.round((+m[1] + (m[2] ? +m[2] / 16 : 0)) * 100) / 100;
  m = v.match(/^(\d+(?:\.\d+)?)\s*(?:oz|ounces?)$/); if(m) return Math.round(+m[1] / 16 * 100) / 100;
  m = v.match(/^(\d+)\s*-\s*(\d+)$/); if(m) return Math.round((+m[1] + +m[2] / 16) * 100) / 100;
  return NaN;
}
function wtTxt(w){ w = +w; if(!w) return ""; const lb = Math.floor(w), oz = Math.round((w - lb) * 16); return lb ? `${lb} lb${oz ? ` ${oz} oz` : ""}` : `${oz} oz`; }
const TROUTISH = /trout|steelhead|splake|salmon/i;
function syncWeightRow(force){
  const sp = $("fSpecies").value, show = force || !!$("fWt").value || (sp && !TROUTISH.test(sp)) || $("fMethod").value !== "fly" || prefWantsWeight();
  $("fWtRow").hidden = !show; $("fWtAdd").hidden = show;
}
$("fWtAdd").onclick = () => { syncWeightRow(true); $("fWt").focus(); };
$("fSpecies").addEventListener("input", () => syncWeightRow());
$("fMethod").addEventListener("change", () => syncWeightRow());
$("fWt").addEventListener("input", () => { const w = parseWeight($("fWt").value), h = $("fWtHint");
  h.className = "hint" + (Number.isNaN(w) ? " bad" : ""); h.textContent = w == null ? "" : Number.isNaN(w) ? "Try 3.5 or 3 lb 8 oz" : wtTxt(w); });

/* ---------- catches from before someone joined ---------- */
const joinDay = () => profile?.created_at ? new Date(profile.created_at).toLocaleDateString("en-CA", { timeZone:"America/Chicago" }) : "0000-00-00";
const beforeJoin = c => !!c && (c.before_join === true || (!c.display_name && c.caught_on && c.caught_on < joinDay()));
const countsForTitles = c => !beforeJoin(c);

/* ---------- how you fish: tailors defaults, species and titles ---------- */
const PREF_METHODS = [["fly","Fly"],["spin","Spin & bait"],["ice","Ice"],["mix","A bit of everything"]];
const PREF_TARGETS = [["trout","Trout"],["bass","Bass"],["walleye","Walleye"],["pike","Pike & musky"],["panfish","Panfish"],["salmon","Salmon & steelhead"],["catfish","Catfish"]];
const PREF_WATERS = [["streams","Creeks & rivers"],["lakes","Lakes"],["both","Both"]];
const TARGET_SPECIES = { trout:["Brook trout","Brown trout","Rainbow trout","Tiger trout"], bass:["Smallmouth bass","Largemouth bass"], walleye:["Walleye","Sauger"],
  pike:["Northern pike","Musky"], panfish:["Bluegill","Crappie","Yellow perch","Pumpkinseed","Rock bass"], salmon:["Chinook salmon","Coho salmon","Steelhead","Lake trout"], catfish:["Channel catfish","Flathead catfish","Bullhead"] };
const TARGET_BADGES = { trout:["brookie","brown","rainbow","twenty","slam","brookie25","brown25","rainbow25","steelhead","waters5"], bass:["bass","bass25"], walleye:["walleye","walleye25"], pike:["pike","musky","pike25"], panfish:["panfish","panfish50"], salmon:["rainbow","steelhead"], catfish:[] };
const fprefs = () => profile?.fishing_prefs || {};
const prefWantsWeight = () => { const t = fprefs().targets || []; return t.some(x => x !== "trout") && !t.includes("trout") || fprefs().method === "spin" || fprefs().method === "ice"; };
function applyPrefs(){
  const p = fprefs();
  // species suggestions: what you chase first
  const dl = $("speciesList"); if(dl && !dl.dataset.base) dl.dataset.base = dl.innerHTML;
  if(dl){ const want = (p.targets || []).flatMap(t => TARGET_SPECIES[t] || []);
    const tmp = document.createElement("div"); tmp.innerHTML = dl.dataset.base;
    const opts = [...tmp.querySelectorAll("option")].map(o => o.value || o.textContent);
    const ordered = [...want, ...opts.filter(o => !want.includes(o))];
    dl.innerHTML = ordered.map(o => `<option>${esc(o)}</option>`).join(""); }
  const sub = document.querySelector(".brand-sub, .brand small, header .sub");
  if(sub) sub.textContent = !p.method || p.method === "fly" ? "Wisconsin fly fishing" : "Wisconsin fishing";
}
function defaultMethod(){ const p = fprefs().method; return p && p !== "mix" ? p : lsGet("fl.method", "fly"); }
function prefsHtml(){
  const p = fprefs(), t = new Set(p.targets || []);
  return `<h4><span>How you fish</span></h4><div class="card prefs">
    <p class="muted" style="margin:0 0 8px;font-size:13.5px">Coulee sets its defaults, species list and title goals around this. You can still log anything.</p>
    <p class="plabel">Mostly</p><div class="chips">${PREF_METHODS.map(([k, l]) => `<button type="button" class="chip" data-pm="${k}" aria-pressed="${p.method === k}">${l}</button>`).join("")}</div>
    <p class="plabel">You go after</p><div class="chips">${PREF_TARGETS.map(([k, l]) => `<button type="button" class="chip" data-pt="${k}" aria-pressed="${t.has(k)}">${l}</button>`).join("")}</div>
    <p class="plabel">Usually on</p><div class="chips">${PREF_WATERS.map(([k, l]) => `<button type="button" class="chip" data-pw="${k}" aria-pressed="${p.waters === k}">${l}</button>`).join("")}</div></div>`;
}
async function savePrefs(next){
  const fishing_prefs = { ...fprefs(), ...next };
  profile = { ...profile, fishing_prefs }; saveCache(); applyPrefs(); renderLog();
  const { error } = await sb.from("profiles").update({ fishing_prefs }).eq("id", me.id);
  if(error) toast("Couldn't save that. It'll stay on this phone for now.");
}
$("log").addEventListener("click", e => {
  const m = e.target.closest("[data-pm]"); if(m){ savePrefs({ method:m.dataset.pm }); return; }
  const w = e.target.closest("[data-pw]"); if(w){ savePrefs({ waters:w.dataset.pw }); return; }
  const t = e.target.closest("[data-pt]"); if(t){ const s = new Set(fprefs().targets || []); s.has(t.dataset.pt) ? s.delete(t.dataset.pt) : s.add(t.dataset.pt); savePrefs({ targets:[...s] }); }
});
