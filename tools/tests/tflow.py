exec(open("base26.py").read())
import time, datetime
G = json.load(open("../../data/gauges.json"))
iso = lambda t: datetime.datetime.utcfromtimestamp(t).strftime("%Y-%m-%dT%H:%M:%S+00:00")
NOW = time.time()
async def main():
    async with async_playwright() as p:
        b = await launch(p)
        for name, url in [("beta", "http://localhost:8790/beta/")]:
          for w, h, touch in [(390, 844, True), (1280, 820, False)]:
            pg = await page(b, w=w, h=h, url=url, extra="localStorage.setItem('fl.useBeta','false');" if name == "live" else "", ctxargs=dict(has_touch=True, is_mobile=True) if touch else None)
            J = lambda o: dict(body=json.dumps(o), content_type="application/json", headers={"access-control-allow-origin": "*"})
            await pg.context.route("https://api.waterdata.usgs.gov/**", lambda r: r.fulfill(**J({"features": [{"properties": {"monitoring_location_id": g[0], "time": iso(NOW - 900), "value": "120"}} for g in G]})) if "latest" in r.request.url else r.fulfill(**J({"features": [{"properties": {"time": iso(NOW - i*3600), "value": str(100+i)}} for i in range(150)]})))
            await pg.context.route("https://api.weather.gov/**", lambda r: r.fulfill(status=500, body="x"))
            D = pg.dbg
            await D("map.setView([43.05,-89.40],12); 1"); await pg.wait_for_timeout(5000)
            pins = pg.locator(".mk-gauge"); n = await pins.count(); best = None
            for i in range(n):
                bx = await pins.nth(i).bounding_box()
                if bx and 130 < bx["y"] < h - 180 and 10 < bx["x"] < w - 90: best = bx; break
            if not best: print(name, w, "no pin in view", n); await pg.context.close(); continue
            x, y = best["x"] + best["width"]/2, best["y"] + best["height"]/2
            top = await pg.evaluate(f"(() => {{ const e = document.elementFromPoint({x},{y}); return e ? e.className + ' / ' + (e.parentElement && e.parentElement.className) : 'none'; }})()")
            if touch: await pg.touchscreen.tap(x, y)
            else: await pg.mouse.click(x, y)
            await pg.wait_for_timeout(2500)
            c = pg.locator(".leaflet-popup-content")
            t = (await c.first.text_content()) if await c.count() else "NO CARD"
            print(name, w, "top element:", top, "| card:", " ".join(t.split())[:120], pg.errs[:2])
            await pg.screenshot(path=f"tflow_{name}_{w}.png")
            await pg.context.close()
        await b.close()
asyncio.run(main())
