exec(open("base26.py").read())
M2 = MOCK.replace("signInWithPassword: async () => { cbs.forEach(cb => cb(\"SIGNED_IN\", session)); return { error:null }; },",
  """signInWithPassword: async (a) => { (window.__calls ||= []).push(['password', a.email]); cbs.forEach(cb => cb("SIGNED_IN", session)); return { error:null }; },
      setSession: async (t) => { (window.__calls ||= []).push(['setSession', t.access_token]); window.__noSession = false; cbs.forEach(cb => cb("SIGNED_IN", session)); return { error:null }; },""").replace(
  "from: t => new Q(t),", """from: t => new Q(t),
    functions: { invoke: async (n, o) => { (window.__calls ||= []).push(['fn', n, o.body.username]); const u = o.body.username, pw = o.body.password;
      if(u === 'locked') return { data:{ error:'wait' }, error:null }; if(u === 'adamh' && pw === 'rightpassword') return { data:{ access_token:'AT', refresh_token:'RT' }, error:null }; return { data:{ error:'nomatch' }, error:null }; } },""")
assert "setSession:" in M2 and "functions:" in M2
BOARD = """(() => { const prev = window.__mockPatch; window.__mockPatch = (db, rpc, ids) => { prev && prev(db, rpc, ids);
  db.profiles[0].created_at = '2026-06-01T12:00:00Z'; db.profiles[0].username = 'adamh';
  db.catches.push({ id:'old1', user_id:ids.ME, trip_id:null, spot_id:null, lat:43.6, lng:-90.9, county:'55123', species:'Brown trout', length_in:27, count:1, fly:'Mouse', caught_on:'2025-08-01', notes:null, photo_path:null, visibility:'county', created_at:'2026-11-01T12:00:00Z' });
  db.catches.push({ id:'new1', user_id:ids.ME, trip_id:null, spot_id:null, lat:43.6, lng:-90.9, county:'55123', species:'Brown trout', length_in:17, count:1, fly:'Adams', caught_on:'2026-08-01', notes:null, photo_path:null, visibility:'county', created_at:'2026-08-01T12:00:00Z' });
}; })();"""
async def main():
    async with async_playwright() as p:
        b = await launch(p); ok = True
        def check(name, cond, extra=""):
            nonlocal ok; ok = ok and bool(cond); print(("PASS " if cond else "FAIL ") + name, extra)
        # ---- sign in ----
        pg = await page(b, ME_PATCH, extra="window.__noSession = true;", w=390, h=844, mock=M2); D = pg.dbg
        check("sign-in screen shows", await pg.is_visible("#auth"))
        check("field says Email or username", "username" in (await pg.text_content('label[for="aEmail"]')).lower())
        async def attempt(who, pw):
            await pg.fill("#aEmail", who); await pg.fill("#aPw", pw); await pg.click("#authGo"); await pg.wait_for_timeout(500)
            return (await pg.text_content("#authMsg")).strip()
        check("wrong username + password -> plain mismatch", "don't match" in await attempt("nobody_here", "whatever12"))
        check("too many tries -> wait message", "Wait 15 minutes" in await attempt("locked", "whatever12"))
        check("nonsense -> asks for email or username", "email or a username" in await attempt("a b!", "whatever12") or "email or a username" in await attempt("x!", "whatever12"))
        m = await attempt("@AdamH ", "rightpassword"); await pg.wait_for_timeout(800)
        calls = await pg.evaluate("window.__calls")
        check("@AdamH signs in through the server and lands in the app", await pg.is_hidden("#auth") and ["setSession", "AT"] in calls, str(calls[-2:]) + " msg:" + m)
        check("no errors", not pg.errs, pg.errs)
        pg = await page(b, ME_PATCH, extra="window.__noSession = true;", w=390, h=844, mock=M2)
        await pg.fill("#aEmail", "Adam@Example.com "); await pg.fill("#aPw", "rightpassword"); await pg.click("#authGo"); await pg.wait_for_timeout(800)
        calls = await pg.evaluate("window.__calls")
        check("an email still signs in the usual way", calls and calls[-1] == ["password", "adam@example.com"] and await pg.is_hidden("#auth"), str(calls))
        await pg.context.close()
        pg = await page(b, ME_PATCH, extra="window.__noSession = true;", w=390, h=844, mock=M2)
        await pg.click("#authUpTab"); check("create account asks for Email", (await pg.text_content('label[for="aEmail"]')).strip() == "Email" and await pg.get_attribute("#aEmail", "type") == "email")
        await pg.click("#authInTab"); await pg.click("#forgotBtn"); check("reset asks for Email", (await pg.text_content('label[for="aEmail"]')).strip() == "Email")
        # ---- leaderboard ----
        pg = await page(b, ME_PATCH + BOARD, w=1280, h=820, mock=M2); D = pg.dbg
        r = json.loads(await D("JSON.stringify((() => { const b = leaderboards('all'); return { biggest: b.biggest.map(x => [x.name, x.v]), mineFish: (b.fish.find(x => x.id === me.id) || {}).v, total: catches.reduce((a,c) => a + fishOf(c), 0), before: catches.filter(beforeJoin).map(c => c.id) }; })())"))
        check("my Before Coulee 27-incher is off the friends leaderboard", all(v != 27 for _, v in r["biggest"]) and "old1" in r["before"], str(r["biggest"][:3]))
        check("it still counts in my own totals", r["total"] > r["mineFish"], f"all my fish {r['total']}, on the board {r['mineFish']}")
        check("no errors (board)", not pg.errs, pg.errs)
        print("ALL PASS" if ok else "SOME FAILED"); await b.close()
asyncio.run(main())
