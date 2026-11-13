exec(open("base26.py").read())
exec(open("perf.py").read().split("async def run")[0].split("FRAMES =")[0] if False else "")
async def drag(pg, x, y, dx, dy, steps=24):
    await pg.mouse.move(x, y); await pg.mouse.down()
    for i in range(1, steps+1): await pg.mouse.move(x + dx*i/steps, y + dy*i/steps); await pg.wait_for_timeout(16)
    await pg.mouse.up()
def top(profile, n=22):
    nodes = {x["id"]: x for x in profile["nodes"]}; dt = profile["timeDeltas"]; samples = profile["samples"]
    self = {}
    for s, d in zip(samples, dt): self[s] = self.get(s, 0) + d
    agg = {}
    for i, t in self.items():
        cf = nodes[i]["callFrame"]; key = (cf["functionName"] or "(anon)", cf["url"].split("/")[-1].split("?")[0], cf["lineNumber"]+1)
        agg[key] = agg.get(key, 0) + t
    tot = sum(agg.values())
    out = []
    for k, t in sorted(agg.items(), key=lambda x: -x[1])[:n]: out.append(f"   {t/1000:8.0f} ms {100*t/tot:5.1f}%  {k[0]}  {k[1]}:{k[2]}")
    return "\n".join(out)
async def main():
    which = sys.argv[1]; scen = sys.argv[2]; w, h, rate = (390, 844, 4) if sys.argv[3] == "phone" else (1440, 900, 1)
    url = "http://localhost:8790/" if which == "live" else "http://localhost:8790/beta/"
    async with async_playwright() as p:
        b = await launch(p); pg = await page(b, w=w, h=h, url=url); D = pg.dbg
        cdp = await pg.context.new_cdp_session(pg); await cdp.send("Emulation.setCPUThrottlingRate", {"rate": rate})
        await D("document.querySelector('.main').classList.add('collapsed'); map.invalidateSize(); 1"); await pg.wait_for_timeout(400)
        cx, cy = w/2, h/2
        await D("openCounty('55123'); 1"); await pg.wait_for_timeout(4000)
        if scen in ("zoom", "panhd"):
            await pg.mouse.move(cx, cy)
        if scen == "panhd":
            for i in range(8): await pg.mouse.wheel(0, -120); await pg.wait_for_timeout(120)
            await pg.wait_for_timeout(2500)
        await cdp.send("Profiler.enable"); await cdp.send("Profiler.setSamplingInterval", {"interval": 500}); await cdp.send("Profiler.start")
        if scen in ("pan", "panhd"):
            for i in range(3): await drag(pg, cx, cy, -140, 80); await drag(pg, cx, cy, 140, -80)
        if scen == "zoom":
            for i in range(8): await pg.mouse.wheel(0, -120); await pg.wait_for_timeout(120)
            await pg.wait_for_timeout(1500)
            for i in range(10): await pg.mouse.wheel(0, 120); await pg.wait_for_timeout(120)
            await pg.wait_for_timeout(1500)
        r = await cdp.send("Profiler.stop")
        print(which, scen, sys.argv[3]); print(top(r["profile"]))
        await b.close()
asyncio.run(main())
