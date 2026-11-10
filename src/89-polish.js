
/* ---------- terrain shading: soft hillshade under the field map, so coulees and ridges show ---------- */
pane("hill", 396, false);
const hillLayer = L.tileLayer("https://basemap.nationalmap.gov/arcgis/rest/services/USGSShadedReliefOnly/MapServer/tile/{z}/{y}/{x}",
  { pane:"hill", minZoom:7, maxNativeZoom:16, maxZoom:18, crossOrigin:true, updateWhenIdle:false, keepBuffer:4,
    bounds:L.latLngBounds([[42.0, -93.3], [47.6, -86.2]]) });   // only Wisconsin: outside its data the service sends blank grey tiles
// the shading is blended onto what's beneath it; give it a plain paper backdrop so it never shows as grey rectangles
pane("hillbase", 394, false);
const hillBase = L.rectangle([[-85, -180], [85, 180]], { pane:"hillbase", stroke:false, fillOpacity:1, interactive:false, className:"hillbase" });
let terrainOn = lsGet("fl.terrain", true);
function syncTerrain(){
  const on = terrainOn && mapView === "field";
  if(on && !map.hasLayer(hillLayer)){ hillBase.addTo(map); hillLayer.addTo(map); }
  if(!on && map.hasLayer(hillLayer)){ map.removeLayer(hillLayer); map.removeLayer(hillBase); }
  const b = $("terrainToggle");
  if(b){ b.hidden = mapView !== "field"; b.setAttribute("aria-pressed", String(terrainOn)); b.textContent = terrainOn ? "Terrain on" : "Terrain off"; }
}
$("terrainToggle").onclick = () => { terrainOn = !terrainOn; lsSet("fl.terrain", terrainOn); syncTerrain(); };
document.addEventListener("mapview", syncTerrain);
syncTerrain();

/* ---------- moving water: a slow drift along trout streams when zoomed in close ---------- */
pane("flow", 433, false);
const flowRenderer = L.svg({ pane:"flow", padding:.5 });
let flowLayer = null, flowKey = "";
function updateFlow(){
  const z = map.getZoom(), ids = [detailFor, ...areaOn].filter(id => id && troutCache[id]);
  const want = !calm() && z >= 13 && ids.length && mapView !== "sat";
  const key = want ? `${ids.join(",")}:${Math.round(z)}:${map.getBounds().pad(.3).toBBoxString()}` : "";
  if(key === flowKey) return; flowKey = key;
  if(flowLayer){ map.removeLayer(flowLayer); flowLayer = null; }
  if(!want) return;
  const b = map.getBounds().pad(.3), g = L.layerGroup();
  for(const [, c, , , paths] of ids.flatMap(id => troutCache[id].t)){
    if(!TROUT[c]) continue;
    for(const pa of paths){
      const ll = smoothPath(pa.map(q => [q[1], q[0]]));
      if(ll.length < 2 || !ll.some(p => b.contains(p))) continue;
      g.addLayer(L.polyline(ll, { renderer:flowRenderer, interactive:false, className:"flow", color:"#fff", weight:z >= 15 ? 2.4 : 1.8, opacity:.8, lineCap:"round" }));
    }
  }
  flowLayer = g.addTo(map);
}
document.addEventListener("mapsettled", updateFlow);
document.addEventListener("mapview", updateFlow);
document.addEventListener("areachange", updateFlow);
