exec(open("base26.py").read())
async def main():
    async with async_playwright() as p:
        b = await launch(p)
        for (w,h) in [(390,844),(1280,820)]:
            pg = await page(b, w=w, h=h); D = pg.dbg
            await D("document.querySelector('.main').classList.add('collapsed'); map.invalidateSize(); 1")
            async def tap(lat,lng,wait=1800):
                pt = await D(f"(()=>{{const p=map.latLngToContainerPoint([{lat},{lng}]); const r=map.getContainer().getBoundingClientRect(); return [p.x+r.left,p.y+r.top];}})()")
                await pg.mouse.click(pt[0], pt[1]); await pg.wait_for_timeout(wait)
            await D("fitState(); 1"); await pg.wait_for_timeout(600)
            await tap(44.6,-90.6)
            print(w, "A fresh statewide tap ->", await D("currentCounty"))
            await D("map.setZoom(map.getZoom()-3,{animate:false}); 1"); await pg.wait_for_timeout(900)
            await D("fitState(); 1"); await pg.wait_for_timeout(900)
            print(w, "  after zoom out county:", await D("currentCounty"), "| area pane taps:", await D("map.getPane(\"area\").style.pointerEvents"))
            await tap(44.6,-90.6)
            print(w, "B statewide tap after zooming out ->", await D("currentCounty"))
            await D("openCounty('55123'); 1"); await pg.wait_for_timeout(3500)
            res = await D("""(()=>{ for(const [cid,g] of Object.entries(areaGroups)){ if(!areaOn.has(cid)) continue; for(const s of g.streams){ for(const line of s.ll){ const ll=line[Math.floor(line.length/2)]; const p=map.latLngToContainerPoint(ll); const r=map.getContainer().getBoundingClientRect();
               if(p.y>170 && p.y<r.height-130 && p.x>20 && p.x<r.width-70 && countyAt(ll[0],ll[1])===cid) return [s.name, p.x+r.left, p.y+r.top, cid]; } } } return 'none: '+[...areaOn]; })()""")
            print(w, "C target:", res)
            if isinstance(res, list):
                await pg.mouse.click(res[1], res[2]); await pg.wait_for_timeout(900)
                print(w, "C neighbor creek tap popup:", (await pg.text_content(".leaflet-popup-content") if await pg.is_visible(".leaflet-popup") else "NONE")[:70])
            await D("map.closePopup(); 1")
            pt = await D("""(()=>{ const b = map.getBounds(); for(let i=0;i<600;i++){ const la=b.getSouth()+Math.random()*(b.getNorth()-b.getSouth()), ln=b.getWest()+Math.random()*(b.getEast()-b.getWest()); const c=countyAt(la,ln); if(c && c!==currentCounty){ const p=map.latLngToContainerPoint([la,ln]); const r=map.getContainer().getBoundingClientRect(); if(p.y>170 && p.y<r.height-130 && p.x>20 && p.x<r.width-70) return [p.x+r.left,p.y+r.top,c]; } } return null; })()""")
            await pg.mouse.click(pt[0], pt[1]); await pg.wait_for_timeout(700)
            vis = await pg.is_visible("[data-opencounty]")
            print(w, "D neighbor land tap, Open county button:", vis, "target", pt[2], "popup:", (await pg.text_content(".leaflet-popup-content"))[:50] if await pg.is_visible(".leaflet-popup") else "")
            if vis:
                await pg.click("[data-opencounty]"); await pg.wait_for_timeout(2500); print(w, "D now in:", await D("currentCounty"))
            print(w, "errors", pg.errs)
        await b.close()
asyncio.run(main())
