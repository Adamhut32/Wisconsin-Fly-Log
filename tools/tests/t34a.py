exec(open("base26.py").read())
ok = True
def check(n, c, d=""):
    global ok; ok = ok and bool(c); print(("PASS " if c else "FAIL ") + n, d)
async def main():
    async with async_playwright() as p:
        b = await launch(p)
        for w, h in [(390, 844), (1280, 820)]:
            pg = await page(b, w=w, h=h); D = pg.dbg
            # three trout catches on different dates
            await D("""(() => { const base = { user_id: me.id, lat: 43.62, lng: -90.92, county: '55123', count: 1, visibility: 'county', water: 'Timber Coulee Creek' };
              catches.push({ ...base, id: 'oos1', species: 'Brown trout', length_in: 15, caught_on: '2026-11-01' },
                           { ...base, id: 'early1', species: 'Brook trout', length_in: 9, caught_on: '2026-02-14' },
                           { ...base, id: 'open1', species: 'Brown trout', length_in: 17, caught_on: '2026-06-10' },
                           { ...base, id: 'bass1', species: 'Smallmouth bass', length_in: 13, caught_on: '2026-11-02', county: '55025', water: 'Yahara River' });
              renderAll(); renderLog(); return 1; })()""")
            pills = await D("JSON.stringify(['oos1','early1','open1','bass1'].map(id => seasonPill(catches.find(c => c.id === id)).replace(/<[^>]+>/g,'').trim()))")
            check(f"{w}: season flags", pills == '["Out of season?","Early season","",""]', pills)
            # stats screen
            await D("setTab('stats'); statYear = '2026'; renderLog(); 1"); await pg.wait_for_timeout(600)
            t = " ".join((await pg.text_content("#log")).split())
            for k in ["Your 2026 season in Coulee", "challenges", "week streak", "Counties fished", "Early trout season opens in"]:
                check(f"{w}: stats shows '{k}'", k in t)
            await pg.screenshot(path=f"t34_stats_{w}.png", full_page=False)
            await pg.evaluate("document.querySelector('#log').scrollTop = 99999"); await pg.wait_for_timeout(200)
            await pg.screenshot(path=f"t34_stats2_{w}.png")
            # county completion on the map
            await pg.click('[data-a="countymode"]'); await pg.wait_for_timeout(1200)
            chip = await pg.is_visible("#cmodeChip"); fill = await D("(() => { const f = counties.find(f => f.id === '55123'); return JSON.stringify(countyStyle(f)); })()")
            check(f"{w}: counties view on map", chip and '"fillOpacity":0.5' in fill, fill[:120])
            await pg.screenshot(path=f"t34_counties_{w}.png")
            await pg.click('[data-a="countymode-off"]'); await pg.wait_for_timeout(300)
            check(f"{w}: counties view turns off", not await pg.is_visible("#cmodeChip"))
            # measure along a creek
            await D("openCounty('55123'); 1"); await pg.wait_for_timeout(3500)
            pick = await D("""(() => { const s = waterCache['55123'].s.filter(s => s[0] && s[2].reduce((a,p)=>a+p.length,0) > 60).sort((a,b)=>b[2][0].length-a[2][0].length)[0];
              const p = s[2][0]; return JSON.stringify({ name: s[0], a: p[Math.floor(p.length*.2)], b: p[Math.floor(p.length*.8)] }); })()""")
            import json as J; m = J.loads(pick)
            await D(f"map.setView([{m['a'][1]},{m['a'][0]}], 12); L.popup().setLatLng([{m['a'][1]},{m['a'][0]}]).setContent(waterPopup({J.dumps(m['name'])}, 'Creek', L.latLng({m['a'][1]},{m['a'][0]}), null, '55123')).openOn(map); 1")
            await pg.wait_for_timeout(500)
            await pg.click('.leaflet-popup [data-a="measure"]'); await pg.wait_for_timeout(300)
            bar1 = await pg.text_content("#measureBar")
            await D(f"handlePick(L.latLng({m['b'][1]},{m['b'][0]})); 1"); await pg.wait_for_timeout(500)
            bar2 = " ".join((await pg.text_content("#measureBar")).split())
            check(f"{w}: measure along {m['name']}", "Tap a second point" in bar1 and "mi along" in bar2 or "ft along" in bar2, bar2)
            await pg.screenshot(path=f"t34_measure_{w}.png")
            print("errors", pg.errs); await pg.context.close()
        await b.close(); print("ALL PASS" if ok else "SOME FAILED")
asyncio.run(main())
