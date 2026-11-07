
/* ---------- friends, feed and leaderboard ---------- */
let boardPeriod = lsGet("fl.boardPeriod", "year");
let friendsView = "feed";
function inPeriod(d, p){
  if(p === "all") return true;
  const now = new Date();
  if(p === "year") return d && d.slice(0,4) === String(now.getFullYear());
  if(p === "month") return d && d.slice(0,7) === `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;
  return true;
}
function everyone(){
  // my catches (all of them, since this is my own view) plus what friends share with me
  const mine = catches.map(c => ({ ...c, user_id: me.id, display_name: profile?.display_name || "You" }));
  return [...mine, ...friendCatches];
}
function leaderboards(p){
  const all = everyone().filter(c => inPeriod(c.caught_on, p) && fishOf(c) > 0);
  const by = {}; const name = {};
  for(const c of all){ (by[c.user_id] ||= []).push(c); name[c.user_id] = c.display_name; }
  if(me && !by[me.id]){ by[me.id] = []; name[me.id] = profile?.display_name || "You"; }
  const ppl = Object.keys(by);
  const rank = (fn, fmt) => ppl.map(id => ({ id, name:name[id], v:fn(by[id]) })).filter(r => r.v > 0).sort((a,b) => b.v - a.v).slice(0, 10).map(r => ({ ...r, txt:fmt(r.v) }));
  const biggest = all.filter(c => c.length_in != null).sort((a,b) => b.length_in - a.length_in).slice(0, 10)
    .map(c => ({ id:c.user_id, name:c.display_name, v:+c.length_in, txt:lenTxt(c.length_in), sub:[c.species, fmtDate(c.caught_on), countyName(c.county)].filter(Boolean).join(" · ") }));
  const species = {};
  for(const c of all) if(c.species && c.length_in != null){ const k = c.species; if(!species[k] || +c.length_in > +species[k].length_in) species[k] = c; }
  const perSpecies = Object.entries(species).sort((a,b) => b[1].length_in - a[1].length_in).map(([k, c]) => ({ id:c.user_id, name:k, v:+c.length_in, txt:lenTxt(c.length_in), sub:`${c.display_name} · ${fmtDate(c.caught_on)}` }));
  return {
    biggest,
    perSpecies,
    fish: rank(cs => cs.reduce((a,c)=>a+fishOf(c),0), v => `${v}`),
    species: rank(cs => new Set(cs.map(c=>c.species).filter(Boolean)).size, v => `${v}`),
    counties: rank(cs => new Set(cs.map(c=>c.county).filter(Boolean)).size, v => `${v}`),
    friendsCount: ppl.length - 1
  };
}
function boardHtml(title, rows, unit, emptyTxt){
  return `<div class="board"><h5>${esc(title)}</h5>${rows.length ? `<ol>${rows.map((r,i) => `<li class="${r.id === me?.id && !r.sub ? "me" : r.id === me?.id ? "me" : ""}"><span class="r">${i+1}</span><span>${esc(r.name)}${r.sub?`<small>${esc(r.sub)}</small>`:""}</span><span class="v">${esc(r.txt)}${unit?` ${unit}`:""}</span></li>`).join("")}</ol>` : `<p class="muted" style="margin:0;padding:10px 12px;font-size:13.5px">${esc(emptyTxt)}</p>`}</div>`;
}
function renderFriendsTab(el){
  const accepted = friendships.filter(f => f.status === "accepted");
  const incoming = friendships.filter(f => f.status === "pending" && f.addressee === me?.id);
  const outgoing = friendships.filter(f => f.status === "pending" && f.requester === me?.id);
  const other = f => people[f.requester === me?.id ? f.addressee : f.requester] || { display_name:"Someone" };
  const views = [["feed","Feed"],["board","Leaderboard"],["people","People"]];
  let body = "";
  if(friendsView === "feed"){
    const posts = friendCatches.slice(0, 40);
    body = posts.length ? `<div class="feed">${posts.map(c => { const url = photoSrc(c.photo_path); return `<article class="post">${url?`<img class="ph" src="${url}" alt="${esc(c.species||"Catch")} photo" loading="lazy">`:""}
      <div class="pb"><span class="who">${esc(c.display_name)}</span><div class="what">${esc(c.species||"Fish")}${c.length_in?` · ${lenTxt(c.length_in)}`:""}${fishOf(c)!==1?` ×${fishOf(c)}`:""}</div>
      <small>${esc([fmtDate(c.caught_on), c.fly, countyName(c.county)].filter(Boolean).join(" · "))}</small>${c.trip_name?`<small>Trip: ${esc(c.trip_name)}</small>`:""}
      <div class="row2" style="margin-top:6px">${c.lat!=null?`<button class="link" type="button" data-go="f:${esc(c.id)}">Show on map</button>`:c.county?`<button class="link" type="button" data-county="${esc(c.county)}">Open ${esc(byId[c.county]?.properties.name || "")} County</button>`:""}</div></div></article>`; }).join("")}</div>`
      : `<div class="empty"><b>${accepted.length ? "No shared catches yet" : "Add your fishing friends"}</b>${accepted.length ? "When friends log catches they share, they show up here." : "Share your friend code below. Once a friend adds you, their shared catches show up here and on the map."}</div>`;
  } else if(friendsView === "board"){
    const b = leaderboards(boardPeriod);
    const periods = [["month","This month"],["year","This year"],["all","All time"]];
    body = `<div class="yearsel">${periods.map(([k,l]) => `<button type="button" data-period="${k}" aria-pressed="${boardPeriod===k}">${l}</button>`).join("")}</div>
      <div class="boards">
      ${boardHtml("Biggest fish", b.biggest, "", "Log a length with your catches to get on this board.")}
      ${boardHtml("Record by species", b.perSpecies, "", "Species records show up once catches have lengths.")}
      ${boardHtml("Most fish", b.fish, "fish", "No fish logged in this period.")}
      ${boardHtml("Most species", b.species, "", "No species logged in this period.")}
      ${boardHtml("Most counties fished", b.counties, "", "No counties logged in this period.")}
      </div><p class="note">Boards count your catches and what friends share with you. Private catches don't count toward anyone else's view.</p>`;
  } else {
    body = `${incoming.length ? `<h4><span>Requests</span></h4><ul class="list">${incoming.map(f => `<li class="item" style="grid-template-columns:1fr auto;cursor:default"><span class="t"><b>${esc(other(f).display_name)}</b><small>Wants to share catches with you</small></span><span class="row2"><button class="btn sm ink" type="button" data-accept="${esc(f.id)}">Accept</button><button class="btn sm" type="button" data-decline="${esc(f.id)}">Decline</button></span></li>`).join("")}</ul>` : ""}
      <h4><span>Friends</span><span>${accepted.length}</span></h4>
      ${accepted.length ? `<ul class="list">${accepted.map(f => `<li class="item" style="grid-template-columns:1fr auto;cursor:default"><span class="t"><b>${esc(other(f).display_name)}</b><small>${friendCatches.filter(c => c.user_id === (f.requester === me.id ? f.addressee : f.requester)).reduce((a,c)=>a+fishOf(c),0)} shared fish</small></span><span data-slot-${esc(f.id)}><button class="link danger" type="button" data-unfriend="${esc(f.id)}">Remove</button></span></li>`).join("")}</ul>` : `<p class="muted">No friends added yet.</p>`}
      ${outgoing.length ? `<h4><span>Waiting on</span></h4><ul class="list">${outgoing.map(f => `<li class="item" style="grid-template-columns:1fr auto;cursor:default"><span class="t"><b>${esc(other(f).display_name)}</b><small>Request sent</small></span><button class="link" type="button" data-decline="${esc(f.id)}">Cancel</button></li>`).join("")}</ul>` : ""}`;
  }
  el.innerHTML = `<div class="eyebrow">Friends</div><h2>Fishing friends</h2>
    <div class="code" style="margin:10px 0 12px"><span>Your friend code</span><b>${esc(profile?.friend_code || "······")}</b><button class="btn sm" type="button" data-a="sharecode">Share</button></div>
    <form id="addFriendForm" class="row2" novalidate style="flex-wrap:nowrap"><input id="friendCode" placeholder="Friend's code" autocapitalize="characters" maxlength="8" aria-label="Friend's code" style="font-family:var(--f-data);letter-spacing:.12em"><button class="btn ink" type="submit">Add</button></form>
    <span class="hint" id="friendMsg" role="alert"></span>
    <label class="check" style="margin-top:10px"><input type="checkbox" id="showFriendsBox" ${showFriends?"checked":""}> Show friends' catches on the map</label>
    <div class="yearsel" style="margin-top:14px">${views.map(([k,l]) => `<button type="button" data-fview="${k}" aria-pressed="${friendsView===k}">${l}${k==="people"&&incoming.length?` (${incoming.length})`:""}</button>`).join("")}</div>
    <div style="margin-top:10px">${body}</div>`;
  $("addFriendForm").addEventListener("submit", async e => {
    e.preventDefault(); const msg = $("friendMsg"); msg.className = "hint"; msg.textContent = "Sending…";
    try{ const n = await addFriend($("friendCode").value); msg.className = "hint ok"; msg.textContent = `Request sent to ${n}. They'll see it in their Friends tab.`; $("friendCode").value = ""; }
    catch(err){ msg.className = "hint bad"; msg.textContent = err.message || "Couldn't add that friend."; }
  });
  $("showFriendsBox").addEventListener("change", e => { showFriends = e.target.checked; lsSet("fl.showFriends", showFriends); renderAll(); });
}
$("log").addEventListener("click", async ev => {
  const t = ev.target;
  const fv = t.closest("[data-fview]"); if(fv){ friendsView = fv.dataset.fview; renderLog(); return; }
  const pe = t.closest("[data-period]"); if(pe){ boardPeriod = pe.dataset.period; lsSet("fl.boardPeriod", boardPeriod); renderLog(); return; }
  const ac = t.closest("[data-accept]"); if(ac){ ac.disabled = true; try{ await answerRequest(ac.dataset.accept, true); toast("Friend added"); }catch(e){ toast("Couldn't accept. Try again."); } return; }
  const de = t.closest("[data-decline]"); if(de){ de.disabled = true; try{ await answerRequest(de.dataset.decline, false); }catch(e){ toast("Couldn't update. Try again."); } return; }
  const un = t.closest("[data-unfriend]"); if(un){ const slot = un.parentElement; slot.innerHTML = `<span class="row2"><button class="link danger" type="button" data-unfriendyes="${esc(un.dataset.unfriend)}">Remove friend</button><button class="link" type="button" data-fview="people">Keep</button></span>`; return; }
  const uy = t.closest("[data-unfriendyes]"); if(uy){ try{ await answerRequest(uy.dataset.unfriendyes, false); toast("Friend removed"); }catch(e){ toast("Couldn't remove. Try again."); } return; }
  if(t.closest('[data-a="sharecode"]')) shareCode();
});
async function shareCode(){
  const url = location.origin + location.pathname;
  const text = `Add me on Wisconsin Fly Log. My friend code is ${profile?.friend_code}. Open ${url} on your phone, create an account, then enter the code in the Friends tab.`;
  if(navigator.share){ try{ await navigator.share({ title:"Wisconsin Fly Log", text, url }); return; }catch(e){ if(e.name === "AbortError") return; } }
  try{ await navigator.clipboard.writeText(text); toast("Invite copied. Paste it into a text to a friend."); }
  catch(e){ toast(`Your code is ${profile?.friend_code}`); }
}
