/* ---------- stream flows (USGS gauges) and the forecast at the stream (National Weather Service) ----------
   data/gauges.json lists Wisconsin's live stream gauges (name and place). Readings come straight from the USGS when the map
   needs them, are kept for 15 minutes, and the last ones are remembered so a gauge still shows something with no signal. */
const USGS = "https://api.waterdata.usgs.gov/";
const FLOW_TTL = 15 * 60000, GAUGE_ZOOM = 8.75;
let gauges = null, flowNow = lsGet("fl.flows", { at:0, q:{}, t:{} }), flowBusy = null, showGauges = lsGet("fl.gauges", true);
const gaugeLayer = L.layerGroup().addTo(map), gaugeDetail = {}, wxCache = {};
const usgs = async (path, params) => { const r = await fetch(USGS + path + "?" + new URLSearchParams(params)); if(!r.ok) throw new Error("usgs " + r.status); return r.json(); };
// what's normal for each gauge at each week of the year: [p10, p25, p75, p90], from the monthly data refresh
let flowNorms = null;
async function loadNorms(){ if(!flowNorms){ try{ const r = await fetch(dataUrl("flownorms.json")); flowNorms = r.ok ? await r.json() : {}; }catch(e){ flowNorms = {}; } } return flowNorms; }
function normFor(id){
  const w = flowNorms && flowNorms[id]; if(!w) return null;
  const d = new Date(), doy = Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(d.getFullYear(), 0, 1)) / 86400000), r = w[Math.min(52, Math.floor(doy / 7))];
  return r && r.every(Number.isFinite) ? { 10:r[0], 25:r[1], 75:r[2], 90:r[3] } : null;
}
async function loadGauges(){ if(!gauges){ try{ const r = await fetch(dataUrl("gauges.json")); gauges = r.ok ? await r.json() : []; }catch(e){ gauges = []; } await loadNorms(); } return gauges; }
async function loadFlows(){
  if(Date.now() - flowNow.at < FLOW_TTL || !navigator.onLine) return flowNow;
  return (flowBusy ||= (async () => {
    try{
      const get = code => usgs("ogcapi/v0/collections/latest-continuous/items", { f:"json", state_name:"Wisconsin", parameter_code:code, limit:"2000", properties:"monitoring_location_id,time,value", skipGeometry:"true" });
      const [q, t] = await Promise.all([get("00060"), get("00010").catch(() => ({ features:[] }))]);
      const fresh = Date.now() - 3 * 86400000, pick = fc => { const o = {}; for(const f of fc.features || []){ const p = f.properties, at = Date.parse(p.time), v = parseFloat(p.value);
        if(at > fresh && Number.isFinite(v) && (!o[p.monitoring_location_id] || at > o[p.monitoring_location_id][1])) o[p.monitoring_location_id] = [v, at]; } return o; };
      flowNow = { at:Date.now(), q:pick(q), t:pick(t) }; lsSet("fl.flows", flowNow);
    }catch(e){ console.warn("flows", e); }
    flowBusy = null; return flowNow;
  })());
}
const cfs = v => v >= 100 ? Math.round(v).toLocaleString() : v >= 10 ? v.toFixed(0) : v.toFixed(1);
const readAgo = at => { const m = Math.round((Date.now() - at) / 60000); return m < 90 ? `${Math.max(1, m)} min ago` : m < 2880 ? `${Math.round(m / 60)} hours ago` : `${Math.round(m / 1440)} days ago`; };
const toF = c => c * 9 / 5 + 32;
// where today's flow sits against every year on record for this date
function flowBand(v, pct){
  if(!pct) return null;
  const at = p => pct[p];
  return v < at(10) ? { k:"low", t:"Very low for this date" } : v < at(25) ? { k:"low", t:"Low for this date" } : v <= at(75) ? { k:"ok", t:"Normal for this date" } : v <= at(90) ? { k:"high", t:"High for this date" } : { k:"high", t:"Very high for this date" };
}
async function gaugeDetails(id){
  const c = gaugeDetail[id]; if(c && Date.now() - c.at < 30 * 60000) return c;
  const d = new Date(), md = `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  await loadNorms();
  const local = normFor(id);
  const [series, stats] = await Promise.all([
    usgs("ogcapi/v0/collections/continuous/items", { f:"json", monitoring_location_id:id, parameter_code:"00060", time:"P7D", limit:"3000", properties:"time,value", skipGeometry:"true" }).catch(() => null),
    local ? null : usgs("statistics/v0/observationNormals", { monitoring_location_id:id, parameter_code:"00060", computation_type:"percentile", start_date:md, end_date:md }).catch(() => null) ]);
  const pts = ((series && series.features) || []).map(f => [Date.parse(f.properties.time), parseFloat(f.properties.value)]).filter(p => Number.isFinite(p[1])).sort((a, b) => a[0] - b[0]);
  let pct = local;
  if(!pct) try{ const v = stats.features[0].properties.data[0].values[0]; pct = {}; v.percentiles.forEach((p, i) => pct[+p] = parseFloat(v.values[i])); if(!Number.isFinite(pct[10]) || !Number.isFinite(pct[90])) pct = null; }catch(e){}
  return (gaugeDetail[id] = { at:Date.now(), pts, pct });
}
function sparkline(pts, pct){
  if(pts.length < 8) return "";
  const W = 260, H = 64, t0 = pts[0][0], t1 = pts[pts.length - 1][0], vs = pts.map(p => p[1]);
  let lo = Math.min(...vs), hi = Math.max(...vs); if(pct){ lo = Math.min(lo, pct[25]); hi = Math.max(hi, pct[75]); } if(hi - lo < 1e-6) hi = lo + 1; const pad = (hi - lo) * .12; lo -= pad; hi += pad;
  const x = t => (t - t0) / (t1 - t0 || 1) * W, y = v => H - (v - lo) / (hi - lo) * H;
  const step = Math.max(1, Math.floor(pts.length / 130)), line = pts.filter((_, i) => i % step === 0 || i === pts.length - 1).map((p, i) => `${i ? "L" : "M"}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join("");
  const band = pct ? `<rect x="0" y="${y(pct[75]).toFixed(1)}" width="${W}" height="${Math.max(1, y(pct[25]) - y(pct[75])).toFixed(1)}" class="norm"/>` : "";
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" role="img" aria-label="Flow over the last 7 days">${band}<path d="${line}"/><circle cx="${W - 1.5}" cy="${y(vs[vs.length - 1]).toFixed(1)}" r="3"/></svg><div class="sparkx"><span>7 days ago</span>${pct ? `<span class="normk">shaded: normal range</span>` : ""}<span>now</span></div>`;
}
function trendText(pts){
  if(pts.length < 8) return "";
  const now = pts[pts.length - 1], dayAgo = pts.filter(p => p[0] <= now[0] - 86400000).pop(), wk = pts[0];
  const ch = (a, b) => (b - a) / Math.max(a, .01);
  const d = dayAgo ? ch(dayAgo[1], now[1]) : 0, w = ch(wk[1], now[1]);
  return d > .15 ? `Rising: up ${Math.round(d * 100)}% since yesterday` : d < -.15 ? `Dropping: down ${Math.round(-d * 100)}% since yesterday` : w > .3 ? `Up ${Math.round(w * 100)}% over the week, steady today` : w < -.3 ? `Down ${Math.round(-w * 100)}% over the week, steady today` : "Steady this week";
}
function gaugeBody(g, det){
  const q = flowNow.q[g[0]], t = flowNow.t[g[0]], band = q ? flowBand(q[0], det ? det.pct : normFor(g[0])) : null, f = t ? toF(t[0]) : null;
  return `${q ? `<div class="flowbig"><b>${cfs(q[0])}</b> cfs${band ? ` <span class="pill flow-${band.k}">${band.t}</span>` : ""}</div><div class="meta">Read ${readAgo(q[1])}${det && det.pts.length ? " · " + esc(trendText(det.pts)) : ""}</div>` : `<p class="muted">No recent reading from this gauge.</p>`}
    ${f != null ? `<div class="meta${f >= 68 ? " warm" : ""}">Water ${Math.round(f)}°F${f >= 68 ? ". Warm for trout: fish early, or give them a rest" : ""}</div>` : ""}
    ${det ? sparkline(det.pts, det.pct) : q ? `<p class="status">Loading the last 7 days…</p>` : ""}`;
}
function gaugePopup(g){
  const div = document.createElement("div"); div.className = "pop";
  const paint = det => { div.innerHTML = `<h3>${esc(g[1])}</h3><div class="meta">USGS stream gauge${g[4] ? ` · drains ${Math.round(g[4]).toLocaleString()} sq mi` : ""}</div>${gaugeBody(g, det)}
      <div data-wx></div><div class="row"><button class="link" type="button" data-a="wx">Forecast here</button><a class="link" href="https://waterdata.usgs.gov/monitoring-location/${esc(g[0])}/" target="_blank" rel="noopener">USGS page</a></div>
      <small class="src">Provisional data from the U.S. Geological Survey. cfs = cubic feet of water per second.</small>`; map._popup && map._popup.update(); };
  paint(gaugeDetail[g[0]] || null);
  if(navigator.onLine) loadFlows().then(() => gaugeDetails(g[0])).then(paint).catch(() => {});
  div.addEventListener("click", ev => { const b = ev.target.closest('[data-a="wx"]'); if(b){ b.hidden = true; showForecast(div.querySelector("[data-wx]"), g[2], g[3]); } });
  return div;
}
async function syncGauges(){
  gaugeLayer.clearLayers();
  if(!showGauges || map.getZoom() < GAUGE_ZOOM) return;
  const list = await loadGauges(); await loadFlows();
  if(!showGauges || map.getZoom() < GAUGE_ZOOM) return;
  gaugeLayer.clearLayers();
  const b = map.getBounds().pad(.1);
  for(const g of list){ if(!b.contains([g[2], g[3]])) continue; const q = flowNow.q[g[0]];
    L.marker([g[2], g[3]], { icon:L.divIcon({ className:"", html:`<div class="mk-gauge" title="${esc(g[1])}">${q ? `<b>${cfs(q[0])}</b> cfs` : "gauge"}</div>`, iconSize:[0, 0] }), zIndexOffset:-100 }).bindPopup(() => gaugePopup(g), { maxWidth:300, minWidth:240 }).addTo(gaugeLayer); }
}
document.addEventListener("mapsettled", syncGauges);
function syncGaugeKey(){ const b = $("gaugeToggle"); b.setAttribute("aria-pressed", String(showGauges)); b.textContent = showGauges ? "Stream flows on" : "Stream flows off"; }
$("gaugeToggle").onclick = () => { showGauges = !showGauges; lsSet("fl.gauges", showGauges); syncGaugeKey(); syncGauges(); };
syncGaugeKey();

/* the nearest gauge on a stream's own card: same river if there is one within about 40 miles, else nothing (a gauge on other water would mislead) */
function nearestGauge(name, ll){
  if(!gauges || !gauges.length) return null;
  const base = String(name || "").toLowerCase().replace(/,.*$/, "").trim(); if(!base) return null;
  let best = null, bd = 1e9;
  for(const g of gauges){ if(!g[1].toLowerCase().startsWith(base)) continue; const d = Math.sqrt(d2([g[3], g[2]], [ll.lng, ll.lat])) * 69; if(d < bd){ bd = d; best = g; } }
  return best && bd <= 40 ? { g:best, mi:bd } : null;
}
waterPopupExtras.push((div, info) => {
  if(info.isLake) return;
  const slot = document.createElement("div"); div.querySelector(".coords").before(slot);
  loadGauges().then(async () => {
    const hit = nearestGauge(info.name, info.ll); if(!hit) return;
    await loadFlows(); const q = flowNow.q[hit.g[0]]; if(!q) return;
    const paint = det => { const band = flowBand(q[0], det ? det.pct : normFor(hit.g[0])), t = flowNow.t[hit.g[0]], f = t ? toF(t[0]) : null;
      slot.innerHTML = `<div class="regs"><b>Flow</b><div><span>Now</span>${cfs(q[0])} cfs${band ? ` · ${band.t.toLowerCase()}` : ""}</div>${det && det.pts.length ? `<div><span>Trend</span>${esc(trendText(det.pts))}</div>` : ""}${f != null ? `<div><span>Water</span>${Math.round(f)}°F${f >= 68 ? " (warm for trout)" : ""}</div>` : ""}
        <small>${esc(hit.g[1])}, ${hit.mi < 1 ? "right here" : Math.round(hit.mi) + " mi away"} · read ${readAgo(q[1])} · <button class="link" type="button" data-gauge="${esc(hit.g[0])}">7-day chart</button></small></div>`; map._popup && map._popup.update(); };
    paint(gaugeDetail[hit.g[0]] || null); if(navigator.onLine) gaugeDetails(hit.g[0]).then(paint).catch(() => {});
  });
  const wx = document.createElement("div"); wx.className = "row"; wx.innerHTML = `<button class="link" type="button" data-a="wx">Forecast here</button>`; const wslot = document.createElement("div"); div.appendChild(wslot); div.appendChild(wx);
  div.addEventListener("click", ev => {
    if(ev.target.closest('[data-a="wx"]')){ wx.hidden = true; showForecast(wslot, info.ll.lat, info.ll.lng); }
    const gb = ev.target.closest("[data-gauge]"); if(gb){ const g = gauges.find(x => x[0] === gb.dataset.gauge); if(g) L.popup({ maxWidth:300, minWidth:240 }).setLatLng([g[2], g[3]]).setContent(gaugePopup(g)).openOn(map); }
  });
});

/* forecast: National Weather Service, for the exact point */
async function forecastAt(lat, lng){
  const key = lat.toFixed(2) + "," + lng.toFixed(2), c = wxCache[key]; if(c && Date.now() - c.at < 30 * 60000) return c.periods;
  const pt = await (await fetch(`https://api.weather.gov/points/${lat.toFixed(4)},${lng.toFixed(4)}`, { headers:{ Accept:"application/geo+json" } })).json();
  const fc = await (await fetch(pt.properties.forecast, { headers:{ Accept:"application/geo+json" } })).json();
  const periods = (fc.properties.periods || []).slice(0, 4).map(p => ({ name:p.name, temp:p.temperature, unit:p.temperatureUnit, wind:`${p.windSpeed || ""} ${p.windDirection || ""}`.trim(), text:p.shortForecast, rain:p.probabilityOfPrecipitation && p.probabilityOfPrecipitation.value }));
  wxCache[key] = { at:Date.now(), periods }; return periods;
}
async function showForecast(slot, lat, lng){
  if(!navigator.onLine){ slot.innerHTML = `<p class="muted">The forecast needs a signal.</p>`; return; }
  slot.innerHTML = `<p class="status">Getting the forecast…</p>`; map._popup && map._popup.update();
  try{
    const ps = await forecastAt(lat, lng); if(!ps.length) throw new Error("empty");
    slot.innerHTML = `<div class="regs wx"><b>Forecast here</b>${ps.map(p => `<div><span>${esc(p.name)}</span>${p.temp != null ? `${p.temp}°${esc(p.unit || "F")} · ` : ""}${esc(p.text || "")}${p.rain ? ` · ${p.rain}% rain` : ""}${p.wind ? ` · wind ${esc(p.wind)}` : ""}</div>`).join("")}<small>National Weather Service</small></div>`;
  }catch(e){ slot.innerHTML = `<p class="muted">Couldn't get the forecast just now.</p>`; }
  map._popup && map._popup.update();
}
