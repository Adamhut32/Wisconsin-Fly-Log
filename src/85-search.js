
/* ---------- creek & lake search ---------- */
let nameIndex = null, qSel = 0, qList = [];
async function loadIndex(){ if(nameIndex) return nameIndex; try{ const r = await fetch(dataUrl("water/index.json")); nameIndex = await r.json(); }catch(e){ nameIndex = []; } return nameIndex; }
function renderQ(){
  const ul = $("qres");
  if(!qList.length){ ul.hidden = !$("q").value.trim(); ul.innerHTML = $("q").value.trim() ? `<li><button disabled>No creeks or lakes by that name</button></li>` : ""; return; }
  ul.hidden = false;
  ul.innerHTML = qList.map((r,i)=>`<li><button class="${i===qSel?"on":""}" data-i="${i}"><span class="wname">${esc(r.name)}</span><small>${esc(r.counties)}</small></button></li>`).join("");
}
$("q").addEventListener("focus", loadIndex);
$("q").addEventListener("input", async () => {
  const q = $("q").value.trim().toLowerCase(); const idx = await loadIndex();
  if(q.length < 2){ qList = []; renderQ(); return; }
  const out = [];
  for(const [name, places] of idx){ const n = name.toLowerCase(); const k = n.startsWith(q) ? 0 : n.includes(" " + q) ? 1 : n.includes(q) ? 2 : -1; if(k < 0) continue;
    out.push({ k, name, places, counties: places.map(p => byId[p[0]]?.properties.name).filter(Boolean).slice(0,3).join(", ") + (places.length > 3 ? "…" : "") }); }
  out.sort((a,b)=>a.k-b.k||a.name.length-b.name.length||a.name.localeCompare(b.name));
  qList = out.slice(0, 10); qSel = 0; renderQ();
});
$("q").addEventListener("keydown", e => {
  if(e.key === "ArrowDown"){ qSel = Math.min(qSel+1, qList.length-1); renderQ(); e.preventDefault(); }
  if(e.key === "ArrowUp"){ qSel = Math.max(qSel-1, 0); renderQ(); e.preventDefault(); }
  if(e.key === "Enter" && qList[qSel]){ goTo(qList[qSel]); e.preventDefault(); }
  if(e.key === "Escape"){ $("qres").hidden = true; $("q").blur(); }
});
$("qres").addEventListener("click", e => { const b = e.target.closest("[data-i]"); if(b) goTo(qList[+b.dataset.i]); });
document.addEventListener("click", e => { if(!e.target.closest(".search")) $("qres").hidden = true; });
async function goTo(r){
  $("qres").hidden = true; $("q").value = r.name; $("q").blur();
  // the place with the biggest stretch of this water
  const p = r.places.slice().sort((a,b)=>((b[3]-b[1])*(b[4]-b[2]))-((a[3]-a[1])*(a[4]-a[2])))[0];
  const cid = p[0];
  if(currentCounty !== cid){ openCounty(cid); await new Promise(r => { map.once("moveend", r); setTimeout(r, 1500); }); }
  await showDetail(cid);
  const b = L.latLngBounds([p[2],p[1]],[p[4],p[3]]);
  map.fitBounds(b, { padding:[50,50], maxZoom:14 });
  map.once("moveend", () => { if(p[5] === "s"){ setHover(r.name); clearTimeout(flashT); flashT = setTimeout(() => setHover(null), 3200); }
    else { const l = detailLakes.find(x => x.name === r.name); if(l){ l.poly.setStyle({ color:css("--hl"), weight:4 }); setTimeout(() => l.poly.setStyle({ color:css("--stream"), weight:.7 }), 3200); } } });
}
