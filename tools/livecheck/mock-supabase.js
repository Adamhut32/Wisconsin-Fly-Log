// Test stand-in for supabase-js with sample data (used only by the local test harness).
(function(){
  const ME = "11111111-1111-4111-8111-111111111111", BO = "22222222-2222-4222-8222-222222222222", CY = "33333333-3333-4333-8333-333333333333";
  const db = {
    profiles: [{ id:ME, display_name:"Adam", friend_code:"K7Q2WX", role:"creator", is_public:true, bio:null, onboarded:true, last_seen_release:0 }, { id:BO, display_name:"Bo Larson", friend_code:"BO1234" }, { id:CY, display_name:"Cy", friend_code:"CY5678" }],
    trips: [{ id:"t1", user_id:ME, name:"Driftless, Memorial Day", start_date:"2026-05-23", end_date:"2026-05-25", base:"Westby", notes:"Sulphurs at dusk.", shared:true, created_at:"2026-05-20T00:00:00Z" }],
    spots: [
      { id:"s1", user_id:ME, name:"Timber Coulee at Bohemian Valley Rd", lat:43.6496, lng:-91.0129, county:"55123", water:"Creek", trout_class:"Class I", target:"Brown trout", notes:"Park at the easement sign.", status:"fished", visibility:"private" },
      { id:"s2", user_id:ME, name:"Rullands Coulee upper", lat:43.6250, lng:-90.9900, county:"55123", water:"Creek", trout_class:"Class I", target:"Brook trout", notes:null, status:"want", visibility:"county" }],
    catches: [
      { id:"c1", user_id:ME, trip_id:"t1", spot_id:"s1", lat:43.6496, lng:-91.0129, county:"55123", species:"Brown trout", length_in:16.5, count:1, fly:"Sulphur", caught_on:"2026-05-23", notes:"Under the big willow", photo_path:null, visibility:"county", created_at:"2026-05-23T20:00:00Z" },
      { id:"c2", user_id:ME, trip_id:"t1", spot_id:"s1", lat:43.6480, lng:-91.0100, county:"55123", species:"Brown trout", length_in:12, count:4, fly:"Pheasant Tail Nymph", caught_on:"2026-05-25", notes:null, photo_path:null, visibility:"exact", created_at:"2026-05-25T12:00:00Z" },
      { id:"c3", user_id:ME, trip_id:null, spot_id:null, lat:43.3597, lng:-91.06628, county:"55023", species:"Brook trout", length_in:9, count:2, fly:"Copper John", caught_on:"2026-09-26", notes:null, photo_path:null, visibility:"county", created_at:"2026-09-26T12:00:00Z" }],
    announcements: [{ id:"an1", body:"Opening weekend tournament starts Saturday. Good luck out there.", created_at:new Date().toISOString() }],
    suggestions: [],
    releases: [{ id:1, title:"Tournaments, following and more", items:["Tournaments with automatic entry.","Follow public anglers.","Public land in county view."], published_at:new Date().toISOString() }],
    tournaments: [],
    follows: [],
    friendships: [{ id:"f1", requester:ME, addressee:BO, status:"accepted" }, { id:"f2", requester:CY, addressee:ME, status:"pending" }]
  };
  const rpc = {
    friend_catches: [
      { id:"fc1", user_id:BO, display_name:"Bo Larson", trip_id:null, trip_name:null, species:"Brown trout", length_in:19, count:1, fly:"Woolly Bugger", caught_on:"2026-06-02", county:"55123", lat:43.60, lng:-90.95, notes:"Big one", photo_path:null, exact:true },
      { id:"fc2", user_id:BO, display_name:"Bo Larson", trip_id:null, trip_name:"Bois Brule weekend", species:"Rainbow trout", length_in:14, count:3, fly:"Hopper", caught_on:"2026-08-10", county:"55031", lat:null, lng:null, notes:null, photo_path:null, exact:false }],
    friend_spots: [], friend_trips: [],
    my_follows: [{ user_id:"44444444-4444-4444-8444-444444444444", display_name:"Driftless Dan", direction:"following" }, { user_id:BO, display_name:"Bo Larson", direction:"follower" }],
    my_tournaments: [
      { id:"tt1", owner:ME, owner_name:"Adam", name:"Memorial Day brown trout", description:"Biggest brown wins a dozen flies.", starts_on:"2026-05-23", ends_on:"2026-05-25", counties:["55123","55023"], area_label:"Vernon, Crawford counties", species:["Brown trout"], scoring:"biggest", require_photo:true, open:false, my_status:"joined", members:2, entries:2 },
      { id:"tt2", owner:BO, owner_name:"Bo Larson", name:"Northwoods summer slam", description:null, starts_on:"2026-11-01", ends_on:"2026-12-15", counties:null, area_label:"Northwoods", species:null, scoring:"species", require_photo:true, open:false, my_status:"invited", members:3, entries:4 }],
    tournament_board: [
      { catch_id:"c1", user_id:ME, display_name:"Adam", species:"Brown trout", length_in:16.5, count:1, caught_on:"2026-05-23", county:"55123", lat:null, lng:null, photo_path:null },
      { catch_id:"x9", user_id:BO, display_name:"Bo Larson", species:"Brown trout", length_in:18, count:1, caught_on:"2026-05-24", county:"55023", lat:null, lng:null, photo_path:null }],
    tournament_people: [{ user_id:ME, display_name:"Adam", status:"joined" }, { user_id:BO, display_name:"Bo Larson", status:"joined" }, { user_id:CY, display_name:"Cy", status:"invited" }],
    find_anglers: [{ id:"44444444-4444-4444-8444-444444444444", display_name:"Driftless Dan", bio:"Guide in Viroqua. Dries only.", featured:true, followers:212, fish:640, following:true }, { id:CY, display_name:"Cy", bio:null, featured:false, followers:3, fish:12, following:false }],
    auto_enter: ["Memorial Day brown trout"], create_tournament: "tt1", creator_overview: [{ anglers:14, public_anglers:4, catches:122, fish:301, trips:9, tournaments:2, open_suggestions:1 }],
    all_suggestions: [{ id:"sg1", user_id:BO, display_name:"Bo Larson", kind:"idea", body:"Could we get a hatch chart by month?", status:"new", reply:null, created_at:"2026-11-06T12:00:00Z" }],
    enter_catch: null, respond_tournament: null, invite_to_tournament: 1, withdraw_catch: null, creator_hide_catch: null
  };
  if(window.__mockPatch) window.__mockPatch(db, rpc, { ME, BO, CY });
  const log = window.__mockLog = [];
  class Q {
    constructor(t){ this.t = t; this.filters = []; this.op = "select"; this._one = false; }
    select(){ return this; } or(){ return this; } order(){ return this; } limit(){ return this; }
    eq(k, v){ this.filters.push(r => r[k] === v); return this; }
    gt(k, v){ this.filters.push(r => r[k] > v); return this; }
    in(k, vs){ this.filters.push(r => vs.includes(r[k])); return this; }
    maybeSingle(){ this._one = true; return this; }
    single(){ this._one = true; return this; }
    single(){ this._one = true; return this; }
    insert(row){ this.op = "insert"; this.row = row; return this; }
    upsert(row){ this.op = "upsert"; this.row = row; return this; }
    update(row){ this.op = "update"; this.row = row; return this; }
    delete(){ this.op = "delete"; return this; }
    then(res, rej){
      const rows = db[this.t] ||= [];
      let out;
      log.push([this.op, this.t, this.row || null]);
      if(this.op === "select" || false){ const r = rows.filter(x => this.filters.every(f => f(x))); out = { data: this._one ? (r[0] || null) : JSON.parse(JSON.stringify(r)), error:null }; }
      else if(this.op === "insert"){ const v = { id:"n" + rows.length, created_at:new Date().toISOString(), status: this.t === "suggestions" ? "new" : "pending", requester:ME, ...this.row }; rows.push(v); out = { data: this._one ? v : null, error:null }; }
      else if(this.op === "upsert"){ const i = rows.findIndex(x => x.id === this.row.id); const v = { user_id:ME, ...(i>=0?rows[i]:{}), ...this.row }; if(i>=0) rows[i] = v; else rows.push(v); out = { data:null, error:null }; }
      else if(this.op === "update"){ rows.filter(x => this.filters.every(f => f(x))).forEach(x => Object.assign(x, this.row)); out = { data:null, error:null }; }
      else { db[this.t] = rows.filter(x => !this.filters.every(f => f(x))); out = { data:null, error:null }; }
      return Promise.resolve(out).then(res, rej);
    }
  }
  const session = { user:{ id:ME, email:"adam@example.com" } };
  let cbs = [];
  window.supabase = { createClient: () => ({
    auth: {
      getSession: async () => (window.__noSession ? { data:{ session:null } } : { data:{ session: window.__signedOut ? null : session } }),
      onAuthStateChange: (cb) => { cbs.push(cb); return { data:{ subscription:{ unsubscribe(){} } } }; },
      signInWithPassword: async () => { cbs.forEach(cb => cb("SIGNED_IN", session)); return { error:null }; },
      signUp: async () => ({ data:{ session:null }, error:null }),
      resetPasswordForEmail: async () => ({ error:null }), updateUser: async () => ({ error:null }), signOut: async () => ({ error:null })
    },
    from: t => new Q(t),
    rpc: async (n, args) => { log.push(['rpc', n, args||null]); const v = rpc[n]; return { data: v === undefined ? [] : JSON.parse(JSON.stringify(v)), error:null }; },
    storage: { from: () => ({ createSignedUrls: async ps => ({ data: ps.map(p => ({ path:p, signedUrl:"" })), error:null }), upload: async () => { log.push(["upload"]); return { error:null }; }, remove: async () => ({ error:null }), download: async () => ({ data:new Blob(['x'],{type:'image/jpeg'}), error:null }) }) }
  }) };
})();
