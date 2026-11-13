exec(open("base26.py").read())
SLOW = MOCK.replace('createSignedUrls: async ps => ({ data: ps.map(p => ({ path:p, signedUrl:"" })), error:null })',
  'createSignedUrls: async ps => { window.__signCalls = (window.__signCalls||0) + 1; await new Promise(r => setTimeout(r, 1500)); return { data: ps.map(p => ({ path:p, signedUrl:"data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7#" + p })), error:null }; }')
assert SLOW != MOCK
PH = """(() => { const prev = window.__mockPatch; window.__mockPatch = (db, rpc, ids) => { prev && prev(db, rpc, ids);
  db.catches[0].photo_path = ids.ME + '/c1-1.jpg'; db.catches[0].more_photos = [{ p: ids.ME + '/c1-2.jpg', h:'0000000000000000' }];
  for(let i = 0; i < 6; i++) db.catches.push({ id:'k'+i, user_id:ids.ME, trip_id:null, spot_id:null, lat:43.60 + i*0.0015, lng:-90.90 + i*0.001, county:'55123', species:'Brown trout', length_in:10+i, count:1, fly:'Adams', caught_on:'2026-07-0'+(i+1), notes:null, photo_path:null, visibility:'county', created_at:'2026-07-01T12:00:00Z' });
}; })();"""
async def main():
    async with async_playwright() as p:
        b = await launch(p); ok = True
        def check(name, cond, extra=""):
            nonlocal ok; ok = ok and bool(cond); print(("PASS " if cond else "FAIL ") + name, extra)
        # ---------- phone ----------
        pg = await page(b, ME_PATCH + PH, w=390, h=844, mock=SLOW, ctxargs={"has_touch":True}); D = pg.dbg
        check("phone opens with the log closed", await D("mainEl.classList.contains('collapsed') && panelCollapsed"))
        mapbox = await pg.locator("#map").bounding_box(); check("map fills the screen under the header", mapbox["height"] > 650, mapbox["height"])
        # photo: open the edit form before the link arrives
        await pg.click("#grab"); await pg.wait_for_timeout(500)
        check("tap on handle opens to half", await D("!panelCollapsed && !panelFull"))
        await D("for(const k in photoCache) delete photoCache[k]; openForm('catch', catches.find(c => c.id === 'c1')); 1"); await pg.wait_for_timeout(200)
        early = await D("$('photoPv').style.backgroundImage"); 
        await pg.wait_for_timeout(2600)
        late = await D("$('photoPv').style.backgroundImage"); late2 = await D("$('ph2Pv').style.backgroundImage")
        check("edit form photo fills in when its link arrives", "data:image" in late, f"(early: {early[:20]!r})")
        check("second photo fills in too", "data:image" in late2)
        check("one batched link request", await pg.evaluate("window.__signCalls") <= 2, await pg.evaluate("window.__signCalls"))
        await pg.click("#cancelBtn"); await pg.wait_for_timeout(300)
        # remembered links
        check("links remembered on the device", await pg.evaluate("Object.keys(JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k => k.startsWith('fl.ph.'))) || '{}')).length") >= 2)
        # panel: drag up to full
        g = await pg.locator("#grab").bounding_box(); gx, gy = g["x"] + g["width"]/2, g["y"] + g["height"]/2
        async def pull(dy, steps=8):
            g = await pg.locator("#grab").bounding_box(); x, y = g["x"] + g["width"]/2, g["y"] + g["height"]/2
            await pg.mouse.move(x, y); await pg.mouse.down()
            for i in range(1, steps+1): await pg.mouse.move(x, y + dy*i/steps); await pg.wait_for_timeout(16)
            await pg.mouse.up(); await pg.wait_for_timeout(600)
        mh = (await pg.locator("#map").bounding_box())["height"]
        await pull(-260)
        lb = await pg.locator("aside.log").bounding_box(); hb = await pg.locator("header").bounding_box()
        check("pull up -> full screen", await D("panelFull") and abs(lb["y"] - (hb["y"] + hb["height"])) < 3 and lb["height"] > 700, f"log top {lb['y']:.0f} h {lb['height']:.0f}")
        check("map kept its size under the sheet", abs((await pg.locator("#map").bounding_box())["height"] - mh) < 2)
        await pg.screenshot(path="z26-full.png")
        check("label says pull down", "down" in (await pg.text_content("#grabLabel")).lower())
        await pg.click('.tabs [data-tab="stats"]'); await pg.wait_for_timeout(400)
        check("tabs work while full", await D("tab === 'stats' && panelFull"))
        await pull(260)
        check("pull down -> half", await D("!panelFull && !panelCollapsed && !mainEl.classList.contains('lift')"))
        await pull(200)
        check("pull down again -> closed", await D("panelCollapsed"))
        await pull(-120); check("pull up -> half", await D("!panelCollapsed && !panelFull"))
        await pull(-300); check("pull up -> full", await D("panelFull"))
        await pg.click("#grab"); await pg.wait_for_timeout(600); check("tap handle when full -> half", await D("!panelFull && !panelCollapsed"))
        await pull(-300); await pg.click('.tabs [data-tab="map"]'); await pg.wait_for_timeout(300)
        await D("focusMarker('c:c3'); 1"); await pg.wait_for_timeout(1800)
        check("jumping to a pin brings the full panel down", await D("!panelFull") and await pg.is_visible(".leaflet-popup"))
        check("no errors (phone)", not pg.errs, pg.errs)
        # clustering
        await D("map.closePopup(); setCollapsed(true); 1"); await pg.wait_for_timeout(400)
        await D("map.setView([43.603,-90.898], 11, {animate:false}); 1"); await pg.wait_for_timeout(1500)
        n = await pg.locator(".mk-cluster").count(); txts = await pg.locator(".mk-cluster b").all_text_contents()
        check("close catches grouped into a numbered pin", n >= 1 and max(map(int, txts)) >= 6, f"{n} groups: {txts}")
        await pg.screenshot(path="z26-cluster.png")
        await pg.locator(".mk-cluster", has_text="6").first.click(); await pg.wait_for_timeout(1800)
        z = await D("map.getZoom()"); fish = await pg.locator(".mk-fish").count()
        check("tapping it zooms in and separates them", z >= 13.5 and fish >= 6 and await pg.locator(".mk-cluster").count() == 0, f"zoom {z}, {fish} pins")
        await pg.screenshot(path="z26-uncluster.png")
        await D("openCounty('55123'); 1"); await pg.wait_for_timeout(3500)
        await D("map.closePopup(); 1")
        # line widths follow zoom
        w1 = await D("detailStreams[0].line.options.weight"); await D("map.setZoom(13,{animate:false}); 1"); await pg.wait_for_timeout(2500)
        w2 = await D("detailStreams[0].line.options.weight"); check("creek lines thinner zoomed out, fuller zoomed in", w2 > w1 * 1.5, f"{w1:.2f} -> {w2:.2f}")
        check("no errors (phone, map)", not pg.errs, pg.errs)
        # ---------- desktop ----------
        pg = await page(b, ME_PATCH + PH, w=1280, h=820, mock=SLOW); D = pg.dbg
        check("desktop opens with the panel showing", await D("!panelCollapsed") and await pg.is_visible(".tabs"))
        await pg.click("#panelHide"); await pg.wait_for_timeout(400); check("desktop hide panel", await D("panelCollapsed") and await pg.is_visible("#panelShow"))
        await pg.click("#panelShow"); await pg.wait_for_timeout(400); check("desktop show panel", await D("!panelCollapsed"))
        # public land tap inside an open county
        await D("openCounty('55123'); 1"); await pg.wait_for_timeout(3500)
        pt = await D("""(() => { const r = map.getContainer().getBoundingClientRect(); for(const id in accessR._layers){ const l = accessR._layers[id]; const c = l.getBounds().getCenter(); const p = map.latLngToContainerPoint(c);
            if(l._containsPoint(map.latLngToLayerPoint(c)) && p.y > 120 && p.y < r.height - 120 && p.x > 320 && p.x < r.width - 120){ let hit = false; for(const k in detailRenderer._layers){ const d = detailRenderer._layers[k]; if(d.options.interactive && d._containsPoint(map.latLngToLayerPoint(c))){ hit = true; break; } } if(!hit) return [p.x + r.left, p.y + r.top]; } } return null; })()""")
        if pt:
            await pg.mouse.click(pt[0], pt[1]); await pg.wait_for_timeout(700)
            t = await pg.text_content(".leaflet-popup-content") if await pg.is_visible(".leaflet-popup") else "NONE"
            check("public land can be tapped inside an open county", "public" in t.lower() or "easement" in t.lower() or "forest" in t.lower() or "DNR" in t, t[:60].replace("\n"," "))
        else: print("SKIP public land tap (none on screen)")
        check("no errors (desktop)", not pg.errs, pg.errs)
        print("ALL PASS" if ok else "SOME FAILED"); await b.close()
asyncio.run(main())
