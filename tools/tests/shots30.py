exec(open("base26.py").read())
async def main():
    async with async_playwright() as p:
        b = await launch(p)
        pg = await page(b, w=390, h=844, ctxargs={"device_scale_factor":2}); D = pg.dbg
        await D("map.setView([45.92,-89.25], 11.5, {animate:false}); 1"); await pg.wait_for_timeout(4500); await pg.screenshot(path="s30-1-vilas.png")
        n = await pg.locator(".mk-place.boat, .mk-place.carry").count(); print("landing pins on screen (Vilas, z11.5):", n, "| shore:", await pg.locator(".mk-place.shore").count())
        await D("(() => { const m = landingLayer.getLayers().find(l => l.options.icon.options.html.includes('boat')); map.setView(m.getLatLng(), map.getZoom(), {animate:false}); setTimeout(() => m.openPopup(), 1200); })(); 1"); await pg.wait_for_timeout(2500); await pg.screenshot(path="s30-2-landing.png"); print((await pg.text_content(".leaflet-popup-content"))[:160])
        await D("map.closePopup(); map.setView([43.615,-90.93], 13.2, {animate:false}); 1"); await pg.wait_for_timeout(4500); await pg.screenshot(path="s30-3-cross.png")
        print("crossings on screen:", await pg.locator(".mk-place.cross").count(), "| gauges:", await pg.locator(".mk-gauge").count())
        await D("map.setView([43.57,-90.64], 10.5, {animate:false}); 1"); await pg.wait_for_timeout(4000); await pg.screenshot(path="s30-4-gauges.png"); print("gauges z10.5:", await pg.locator(".mk-gauge").count())
        print(pg.errs); await b.close()
asyncio.run(main())
