/* Wisconsin Fly Log — built from src/*.js by build.py. Edit the files in src/, then run: python3 build.py */
(async function(){
"use strict";
const CFG = window.FLYLOG_CONFIG;
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const icon = (id) => `<svg><use href="#${id}"/></svg>`;
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const dataUrl = p => "data/" + p + "?v=" + CFG.dataVersion;
const DETAIL_ZOOM = 9;
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)));
const todayStr = () => { const t = new Date(); return `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,"0")}-${String(t.getDate()).padStart(2,"0")}`; };
const lsGet = (k, d) => { try{ const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); }catch(e){ return d; } };
const lsSet = (k, v) => { try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} };
let toastT; function toast(msg){ const t=$("toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(()=>t.hidden=true, 3000); }

/* ---------- state ---------- */
let me = null;                 // { id, email }
let profile = null;            // { id, display_name, friend_code }
let spots = [], catches = [], trips = [];
let friendCatches = [], friendSpots = [], friendTrips = [], friendships = [], people = {};
let showFriends = lsGet("fl.showFriends", true);
let showAccess = lsGet("fl.showAccess", true);
let canWrite = true;
let currentCounty = null;
let loadState = "loading";     // loading | ready | offline
let tab = "map";               // map | trips | friends | stats | me
let tripOpen = null;           // trip id shown in Trips tab

/* ---------- base geography ---------- */
const GEO = await (await fetch(dataUrl("geo.json"))).json();
const counties = GEO.counties.features;
const byId = {}; counties.forEach(f => byId[f.id] = f);
function pipRing(x, y, ring){ let ins=false; for(let i=0,j=ring.length-1;i<ring.length;j=i++){ const xi=ring[i][0],yi=ring[i][1],xj=ring[j][0],yj=ring[j][1]; if(((yi>y)!=(yj>y)) && (x<(xj-xi)*(y-yi)/(yj-yi)+xi)) ins=!ins; } return ins; }
function inPoly(x,y,poly){ if(!pipRing(x,y,poly[0])) return false; for(let k=1;k<poly.length;k++) if(pipRing(x,y,poly[k])) return false; return true; }
function countyAt(lat, lng){
  for(const f of counties){ const g=f.geometry; const polys = g.type==="Polygon"?[g.coordinates]:g.coordinates; if(polys.some(p=>inPoly(lng,lat,p))) return f.id; }
  return null;
}
function labelPoint(f){
  const g=f.geometry; const polys = g.type==="Polygon"?[g.coordinates]:g.coordinates;
  let best=null, bestA=0;
  for(const p of polys){ const r=p[0]; let a=0,cx=0,cy=0; for(let i=0,j=r.length-1;i<r.length;j=i++){ const c=r[j][0]*r[i][1]-r[i][0]*r[j][1]; a+=c; cx+=(r[j][0]+r[i][0])*c; cy+=(r[j][1]+r[i][1])*c; } a/=2; if(Math.abs(a)>bestA){ bestA=Math.abs(a); best=[cy/(6*a), cx/(6*a)]; } }
  return best;
}
const LABEL = {}; counties.forEach(f => LABEL[f.id] = labelPoint(f));
function countyName(id){ return byId[id] ? byId[id].properties.name + " County" : "Outside Wisconsin"; }
function gmaps(lat,lng){ return `https://www.google.com/maps/search/?api=1&query=${lat.toFixed(5)},${lng.toFixed(5)}`; }
function fmtDate(d, opts){ if(!d) return ""; const [y,m,dd]=d.split("-").map(Number); return new Date(y,m-1,dd).toLocaleDateString(undefined, opts || {month:"short",day:"numeric",year:"numeric"}); }
function fmtRange(a, b){ if(!a) return ""; if(a === b) return fmtDate(a); const ya = a.slice(0,4), yb = b.slice(0,4);
  return ya === yb ? `${fmtDate(a,{month:"short",day:"numeric"})} – ${fmtDate(b)}` : `${fmtDate(a)} – ${fmtDate(b)}`; }
const fishOf = c => (c.count ?? 1);
const lenTxt = v => v == null || v === "" ? "" : `${+v}″`;

/* ---------- derived numbers ---------- */
function countyStats(id){
  let s=0,f=0; for(const x of spots) if(x.county===id) s++; for(const c of catches) if(c.county===id) f+=fishOf(c);
  return { spots:s, fish:f };
}
function totals(){
  const ids = new Set([...spots.map(s=>s.county), ...catches.map(c=>c.county)].filter(Boolean));
  return { spots:spots.length, fish:catches.reduce((a,c)=>a+fishOf(c),0), counties:ids.size };
}
