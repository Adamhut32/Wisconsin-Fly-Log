exec(open("base26.py").read())
# a fake browser push system: two service workers (live app and test copy), each able to hold a sign-up
FAKE = """
(() => {
  const root = new URL('../', location.href).href, here = new URL('./', location.href).href;
  const mk = (scope, ep) => { const reg = { scope, active:{}, _sub:null, update: async()=>{}, addEventListener(){}, pushManager:{ getSubscription: async () => reg._sub, subscribe: async () => { if(window.__noSilentSubscribe) throw new Error('needs a tap'); reg._sub = sub(reg, 'https://push.example/' + (window.__n = (window.__n||0)+1)); return reg._sub; } } }; if(ep) reg._sub = sub(reg, ep); return reg; };
  const sub = (reg, ep) => ({ endpoint:ep, toJSON: () => ({ endpoint:ep, keys:{ p256dh:'k', auth:'a' } }), unsubscribe: async () => { reg._sub = null; (window.__unsub ||= []).push(ep); return true; } });
  const S = window.__regs = { root: mk(root, window.__rootEp), beta: mk(here, window.__betaEp) };
  const sw = { ready: Promise.resolve(S.beta), controller:null, getRegistration: async u => (new URL(u || './', location.href).href === root ? S.root : S.beta), getRegistrations: async () => [S.root, S.beta],
    register: async () => S.beta, addEventListener(){} };
  Object.defineProperty(navigator, 'serviceWorker', { value: sw, configurable:true });
  window.PushManager = function(){}; window.Notification = { permission:'granted', requestPermission: async () => 'granted' };
})();
"""
SUBS = """(() => { const prev = window.__mockPatch; window.__mockPatch = (db, rpc, ids) => { prev && prev(db, rpc, ids);
  db.push_subscriptions = (window.__rows || []).map((ep, i) => ({ id:'r'+i, user_id:ids.ME, endpoint:ep, device_id:null })); window.__db = db; }; })();"""
async def scenario(b, name, rootEp, betaEp, rows, noSilent=False):
    pre = f"window.__rootEp = {json.dumps(rootEp)}; window.__betaEp = {json.dumps(betaEp)}; window.__rows = {json.dumps(rows)}; window.__noSilentSubscribe = {json.dumps(noSilent)};"
    pg = await page(b, ME_PATCH + SUBS, extra=pre + FAKE, w=390, h=844); D = pg.dbg
    await pg.wait_for_timeout(1000); await D("pushTidied = false; tidyPush()"); await pg.wait_for_timeout(600)
    st = await pg.evaluate("({ root: __regs.root._sub && __regs.root._sub.endpoint, beta: __regs.beta._sub && __regs.beta._sub.endpoint, rows: __db.push_subscriptions.map(r => [r.endpoint, !!r.device_id]), unsub: window.__unsub || [] })")
    print(name, "->", json.dumps(st), "| state:", await D("pushStateV"), "| errors:", pg.errs)
    await pg.context.close(); return st
async def main():
    async with async_playwright() as p:
        b = await launch(p); ok = True
        s = await scenario(b, "Adam's phone: sign-ups on both the live app and the test copy", "https://push.example/A", "https://push.example/B", ["https://push.example/A", "https://push.example/B"])
        ok &= s["root"] == "https://push.example/A" and s["beta"] is None and s["rows"] == [["https://push.example/A", True]]
        s = await scenario(b, "only on the test copy, phone allows a quiet move", None, "https://push.example/B", ["https://push.example/B"])
        ok &= s["root"] is not None and s["beta"] is None and len(s["rows"]) == 1 and s["rows"][0][0] == s["root"]
        s = await scenario(b, "only on the test copy, phone refuses a quiet move", None, "https://push.example/B", ["https://push.example/B"], True)
        ok &= s["root"] is None and s["beta"] == "https://push.example/B" and len(s["rows"]) == 1
        s = await scenario(b, "only on the live app (the normal case)", "https://push.example/A", None, ["https://push.example/A"])
        ok &= s["root"] == "https://push.example/A" and len(s["rows"]) == 1 and s["rows"][0][1]
        s = await scenario(b, "live sign-up whose row went missing", "https://push.example/A", None, [])
        ok &= len(s["rows"]) == 1
        s = await scenario(b, "no sign-ups at all", None, None, [])
        ok &= s["root"] is None and s["rows"] == []
        print("ALL PASS" if ok else "SOME FAILED"); await b.close()
asyncio.run(main())
