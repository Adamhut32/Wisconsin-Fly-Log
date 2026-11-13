exec(open("base26.py").read())
import statistics, time
FRAMES = """(() => { window.__fr = []; let last = performance.now(); window.__frOn = true; const f = t => { window.__fr.push(t - last); last = t; if(window.__frOn) requestAnimationFrame(f); }; requestAnimationFrame(f);
  window.__lt = []; try{ new PerformanceObserver(l => { for(const e of l.getEntries()) window.__lt.push(e.duration); }).observe({ entryTypes:['longtask'] }); }catch(e){} })()"""
async def frames(pg):
    fr = await pg.evaluate("(() => { const f = window.__fr.slice(2); window.__fr = []; const l = window.__lt.slice(); window.__lt = []; return [f, l]; })()")
    f, l = fr
    if not f: return "no frames"
    f.sort(); n = len(f)
    return f"frames {n:4d}  p50 {f[n//2]:5.1f}  p95 {f[int(n*.95)]:6.1f}  max {f[-1]:6.1f} ms | long tasks {len(l):3d} total {sum(l):6.0f} ms"
async def drag(pg, x, y, dx, dy, steps=24):
    await pg.mouse.move(x, y); await pg.mouse.down()
    for i in range(1, steps+1): await pg.mouse.move(x + dx*i/steps, y + dy*i/steps); await pg.wait_for_timeout(16)
    await pg.mouse.up()
async def run(b, url, w, h, rate, label):
    t0 = time.time()
    pg = await page(b, w=w, h=h, url=url, extra=("localStorage.setItem('fl.useBeta','false');" if "/beta/" not in url else "")); D = pg.dbg
    assert ("/beta/" in pg.url) == ("/beta/" in url), pg.url
    cdp = await pg.context.new_cdp_session(pg); await cdp.send("Emulation.setCPUThrottlingRate", {"rate": rate})
    print(f"== {label}  {w}x{h}  cpu/{rate}")
    nav = await pg.evaluate("(() => { const n = performance.getEntriesByType('navigation')[0]; const r = performance.getEntriesByType('resource'); return [Math.round(n.domContentLoadedEventEnd), Math.round(n.loadEventEnd), r.reduce((a,x)=>a+(x.transferSize||0),0), r.length]; })()")
    print("   dom ready / load ms:", nav[0], nav[1], "| transferred KB:", round(nav[2]/1024), "requests:", nav[3])
    await D("document.querySelector('.main').classList.add('collapsed'); map.invalidateSize(); 1"); await pg.wait_for_timeout(500)
    import os
    if os.environ.get("OFF"): await D("try{ showLandings=false; showCrossings=false; showGauges=false; syncPlaces(); syncGauges(); }catch(e){} 1")
    cx, cy = w/2, h/2
    await pg.evaluate(FRAMES); await pg.wait_for_timeout(300); await frames(pg)
    for i in range(3): await drag(pg, cx, cy, -120, 60); await drag(pg, cx, cy, 120, -60)
    print("   pan statewide      ", await frames(pg))
    t = time.time(); await D("openCounty('55123'); 1")
    for i in range(200):
        if await D("!!detailLayer && !areaBusy"): break
        await pg.wait_for_timeout(50)
    await pg.wait_for_timeout(700)
    print(f"   open county {time.time()-t-0.7:5.2f}s  ", await frames(pg))
    for i in range(3): await drag(pg, cx, cy, -140, 80); await drag(pg, cx, cy, 140, -80)
    print("   pan in county      ", await frames(pg))
    await pg.mouse.move(cx, cy)
    for i in range(8): await pg.mouse.wheel(0, -120); await pg.wait_for_timeout(120)
    await pg.wait_for_timeout(1500)
    print("   zoom in (wheel x8) ", await frames(pg), "zoom", await D("map.getZoom()"))
    for i in range(3): await drag(pg, cx, cy, -140, 80); await drag(pg, cx, cy, 140, -80)
    await pg.wait_for_timeout(600)
    print("   pan zoomed in      ", await frames(pg))
    for i in range(10): await pg.mouse.wheel(0, 120); await pg.wait_for_timeout(120)
    await pg.wait_for_timeout(1500)
    print("   zoom out (wheel x10)", await frames(pg), "zoom", await D("map.getZoom()"))
    heap = await pg.evaluate("performance.memory ? Math.round(performance.memory.usedJSHeapSize/1048576) : -1")
    try: print("   pins:", await D("[landingLayer.getLayers().length, crossLayer.getLayers().length, gaugeLayer.getLayers().length]"))
    except Exception: pass
    print("   JS heap MB:", heap, "| errors:", pg.errs)
    await pg.context.close()
async def main():
    async with async_playwright() as p:
        b = await launch(p)
        which = sys.argv[1:] or ["live", "beta"]
        for name in which:
            url = "http://localhost:8790/" if name == "live" else "http://localhost:8790/beta/"
            await run(b, url, 390, 844, 4, name + " phone")
            if not __import__("os").environ.get("PHONE"): await run(b, url, 1440, 900, 1, name + " desktop")
        await b.close()
asyncio.run(main())
