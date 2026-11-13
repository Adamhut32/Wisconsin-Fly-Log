exec(open("base26.py").read())
T = """(() => { const prev = window.__mockPatch; window.__mockPatch = (db, rpc, ids) => { prev && prev(db, rpc, ids);
  db.profiles[0].created_at = '2020-01-01T12:00:00Z';
  const add = (id, sp, n, water, county) => db.catches.push({ id, user_id:ids.ME, trip_id:null, spot_id:null, lat:43.6, lng:-90.9, county: county || '55123', species:sp, length_in:12, count:n, fly:'Adams', caught_on:'2026-07-01', notes:null, photo_path:null, visibility:'county', water, created_at:'2026-07-01T12:00:00Z' });
  add('t1', 'Brown trout', 26, 'Timber Coulee Creek'); add('t2', 'Lake sturgeon', 1, 'Wisconsin River', '55111'); add('t3', 'Steelhead', 1, 'Root River', '55101');
  add('t4', 'Brook trout', 1, 'Rullands Coulee Creek'); add('t5', 'Brook trout', 1, 'Spring Coulee Creek'); add('t6', 'Brook trout', 1, 'Spring Coulee Creek', '55063');
}; })();"""
async def main():
    async with async_playwright() as p:
        b = await launch(p); ok = True
        def check(name, cond, extra=""):
            nonlocal ok; ok = ok and bool(cond); print(("PASS " if cond else "FAIL ") + name, extra)
        pg = await page(b, ME_PATCH + T, w=1280, h=820); D = pg.dbg
        got = json.loads(await D("JSON.stringify(badges().filter(b => b.earned).map(b => b.name))")); allb = await D("BADGES.length")
        check("new titles earned", all(x in got for x in ["Brown Trout Regular", "River Dinosaur", "Chrome Chaser", "Water Wanderer"]), str(got))
        check("brown trout 50 not yet earned", "Brown Trout Fanatic" not in got, f"{allb} titles in all")
        check("same creek name in two counties counts as two waters", await D("badgeStats().waters") == 6, await D("badgeStats().waters"))
        check("title names fit (40 characters)", await D("BADGES.every(b => b.name.length <= 40) && new Set(BADGES.map(b => b.name)).size === BADGES.length && new Set(BADGES.map(b => b.id)).size === BADGES.length"))
        await pg.click('.tabs [data-tab="stats"]'); await pg.wait_for_timeout(500)
        await pg.screenshot(path="z28-titles.png")
        # filters
        await pg.click('.tabs [data-tab="map"]'); await D("openCounty('55123'); 1"); await pg.wait_for_timeout(3500)
        cnt = "JSON.stringify((() => { const n = {1:0,2:0,3:0}; for(const id in detailRenderer._layers){ const l = detailRenderer._layers[id]; if(l._bw === 6){ const c = l.options.color; for(const k of [1,2,3]) if(c === css(TROUT[k].tok)) n[k]++; } } return n; })())"
        n0 = json.loads(await D(cnt)); check("all three classes drawn to start", n0["1"] > 0 and n0["2"] > 0, str(n0))
        await pg.click('#legend [data-tclass="1"]'); await pg.wait_for_timeout(600)
        n1 = json.loads(await D(cnt)); check("Class I switched off hides only Class I", n1["1"] == 0 and n1["2"] == n0["2"] and n1["3"] == n0["3"], str(n1))
        check("the key shows it's off", await pg.get_attribute('#legend [data-tclass="1"]', "aria-pressed") == "false")
        await pg.screenshot(path="z28-filter.png")
        await pg.click('#legend [data-tclass="1"]'); await pg.wait_for_timeout(600)
        check("switched back on", json.loads(await D(cnt)) == n0)
        # open now: pretend it's July (regular season) vs today (November, closed except year-round water)
        openJuly = await D("(() => { const t = troutCache['55123'].t; return t.filter(s => { const p = s[4][0], q = p[Math.floor(p.length/2)]; const reg = nearestReg(s[0], {lat:q[1], lng:q[0]}, '55123') || GENERAL_REG; const st = seasonStatus(reg, new Date(2026, 6, 4)); return st && st.kind !== 'closed'; }).length + '/' + t.length; })()")
        openNow = await D("(() => { const t = troutCache['55123'].t; return t.filter(s => troutOpenNow('55123', s)).length + '/' + t.length; })()")
        print("   open on July 4:", openJuly, "| open today:", openNow)
        check("general season: open July 4, closed Nov 10, early season Feb 1", await D("seasonStatus(GENERAL_REG, new Date(2026,6,4)).kind + seasonStatus(GENERAL_REG, new Date(2026,10,10)).kind + seasonStatus(GENERAL_REG, new Date(2026,1,1)).kind") == "openclosedearly")
        await pg.click("#openToggle"); await pg.wait_for_timeout(700)
        n2 = json.loads(await D(cnt)); shown = sum(n2.values()); want = int(openNow.split("/")[0])
        check("Open now shows only water open today", shown <= sum(n0.values()) and (shown == 0) == (want == 0), f"{shown} stretches drawn, {want} open today")
        await pg.click("#openToggle"); await pg.wait_for_timeout(500)
        check("filter remembered and reset", json.loads(await D(cnt)) == n0)
        await pg.click("#classHelp"); await pg.wait_for_timeout(300)
        check("class help opens", await pg.is_visible("text=Wild trout, no stocking")); await pg.screenshot(path="z28-help.png")
        await pg.click("[data-close]"); await pg.wait_for_timeout(200)
        check("no errors", not pg.errs, pg.errs)
        pg = await page(b, ME_PATCH + T, w=390, h=844); D = pg.dbg
        await D("openCounty('55123'); 1"); await pg.wait_for_timeout(3000); await pg.click(".lgkey"); await pg.wait_for_timeout(300); await pg.screenshot(path="z28-phonekey.png")
        await pg.click("#classHelp"); await pg.wait_for_timeout(300); await pg.screenshot(path="z28-phonehelp.png")
        check("no errors (phone)", not pg.errs, pg.errs)
        print("ALL PASS" if ok else "SOME FAILED"); await b.close()
asyncio.run(main())
