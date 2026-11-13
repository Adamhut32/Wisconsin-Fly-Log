exec(open("base26.py").read())
NEW = ME_PATCH + """(() => { const prev = window.__mockPatch; window.__mockPatch = (db, rpc, ids) => { prev && prev(db, rpc, ids); db.profiles[0].onboarded = false; db.profiles[0].username = 'adamh'; }; })();"""
async def main():
    async with async_playwright() as p:
        b = await launch(p); bad = 0
        for (w,h) in [(390,844),(1280,820)]:
            pg = await page(b, NEW, w=w, h=h); D = pg.dbg
            await pg.wait_for_timeout(1500)
            print(w, "guide open:", await pg.is_visible("#guide"))
            n = await D("guideSteps.length")
            for i in range(n):
                await pg.wait_for_timeout(700)
                s = await D("JSON.stringify({ t: guideSteps[guideStep].t, at: guideSteps[guideStep].at || null, open: !!guideSteps[guideStep].open })")
                s = json.loads(s); vis = None
                if s["at"]:
                    r = await pg.evaluate("(sel) => { const e = document.querySelector(sel); if(!e) return null; const r = e.getBoundingClientRect(); return [r.left, r.top, r.width, r.height, innerWidth, innerHeight]; }", s["at"])
                    vis = bool(r and r[2] > 4 and r[3] > 4 and r[0] >= -2 and r[1] >= -2 and r[0] + r[2] <= r[4] + 2 and r[1] + r[3] <= r[5] + 2)
                    if not vis: bad += 1
                print(f"  {w} step {i+1}/{n} {s['t'][:28]:28s} at {str(s['at'])[:34]:34s} on screen: {vis}   panel closed: {await D('panelCollapsed')}")
                await pg.click("#guideNext")
            await pg.wait_for_timeout(500); print(w, "errors", pg.errs)
        print("ALL PASS" if not bad else f"{bad} TARGETS OFF SCREEN"); await b.close()
asyncio.run(main())
