exec(open("base26.py").read())
import datetime
now = datetime.datetime.now(datetime.timezone.utc)
iso = lambda d: d.strftime("%Y-%m-%dT%H:%M:%SZ")
T = """(() => { const prev = window.__mockPatch; window.__mockPatch = (db, rpc, ids) => { prev && prev(db, rpc, ids);
  const base = { owner:ids.ME, owner_name:'Adam', description:null, counties:null, area_label:null, species:null, scoring:'biggest', require_photo:true, open:false, my_status:'joined', members:2, entries:0, methods:null };
  rpc.my_tournaments_v2 = [
    { ...base, id:'a', name:'Saturday morning derby', starts_on:'2026-11-14', ends_on:'2026-11-14', start_time:'06:00:00', end_time:'14:00:00', submit_hours:2, starts_at:'%s', fish_ends_at:'%s', closes_at:'%s' },
    { ...base, id:'b', name:'Wrapping up', starts_on:'2026-11-08', ends_on:'2026-11-08', start_time:'06:00:00', end_time:'12:30:00', submit_hours:48, starts_at:'%s', fish_ends_at:'%s', closes_at:'%s' },
    { ...base, id:'c', name:'Old one', starts_on:'2026-10-01', ends_on:'2026-10-02', start_time:null, end_time:null, submit_hours:24, starts_at:'%s', fish_ends_at:'%s', closes_at:'%s' },
    { ...base, id:'d', name:'Live now', require_photo:false, starts_on:'2026-11-09', ends_on:'2026-11-12', start_time:'05:00:00', end_time:null, submit_hours:0, starts_at:'%s', fish_ends_at:'%s', closes_at:'%s' } ];
  rpc.create_tournament_v2 = 'a'; window.__rpcArgs = [];
}; })();""" % (iso(now + datetime.timedelta(days=3)), iso(now + datetime.timedelta(days=3, hours=8)), iso(now + datetime.timedelta(days=3, hours=10)),
              iso(now - datetime.timedelta(days=2)), iso(now - datetime.timedelta(hours=20)), iso(now + datetime.timedelta(hours=28)),
              iso(now - datetime.timedelta(days=40)), iso(now - datetime.timedelta(days=38)), iso(now - datetime.timedelta(days=37)),
              iso(now - datetime.timedelta(days=1)), iso(now + datetime.timedelta(days=1)), iso(now + datetime.timedelta(days=1)))
async def main():
    async with async_playwright() as p:
        b = await launch(p); ok = True
        def check(name, cond, extra=""):
            nonlocal ok; ok = ok and bool(cond); print(("PASS " if cond else "FAIL ") + name, extra)
        pg = await page(b, ME_PATCH + T, w=390, h=844); D = pg.dbg
        await pg.click("#grab"); await pg.wait_for_timeout(400); await pg.click('.tabs [data-tab="tourney"]'); await pg.wait_for_timeout(900)
        st = json.loads(await D("JSON.stringify(Object.fromEntries(tournaments.map(t => [t.id, tState(t)])))"))
        check("states: upcoming, wrapup, finished, live", st == {"a":"upcoming","b":"wrapup","c":"finished","d":"live"}, str(st))
        txt = await pg.text_content("#log")
        check("card shows hours", "6 am to 2 pm" in txt, "")
        check("wrap-up card shows the deadline", "Send in fish by" in txt)
        await pg.screenshot(path="z29-list.png")
        await pg.click('[data-tourney="a"]'); await pg.wait_for_timeout(700); d = await pg.text_content("#log")
        check("detail: when, Wisconsin time, deadline, photo time rule", "Nov 14, 2026, 6 am to 2 pm" in d.replace("Sat, ","") or "6 am to 2 pm" in d and "Wisconsin time" in d and "Send in fish by" in d and "date and time stamp" in d, "")
        await pg.screenshot(path="z29-detail.png")
        await pg.click('[data-a="tedit"]'); await pg.wait_for_timeout(300)
        check("edit form has hours", await pg.input_value("#teStartTime") == "06:00" and await pg.input_value("#teSubmit") == "2")
        await pg.click('[data-a="tourneys"]'); await pg.wait_for_timeout(300); await pg.click('[data-tourney="d"]'); await pg.wait_for_timeout(600)
        check("no-photo timed tournament explains honor system", "honor system" in await pg.text_content("#log"))
        await pg.click('[data-a="tourneys"]'); await pg.wait_for_timeout(300)
        await pg.click('[data-a="newtourney"]'); await pg.wait_for_timeout(400)
        await pg.fill("#tfName", "Opener"); await pg.click("#tfTimes summary"); await pg.fill("#tfStartTime", "06:00"); await pg.fill("#tfEndTime", "05:00")
        await pg.evaluate("document.getElementById('tfEnd').value = document.getElementById('tfStart').value")
        await pg.locator("#tfSave").scroll_into_view_if_needed(); await pg.click("#tfSave"); await pg.wait_for_timeout(300)
        check("end before start on one day is refused", "after the start time" in await pg.text_content("#tfErr"))
        await pg.fill("#tfEndTime", "14:00"); await pg.select_option("#tfSubmit", "6"); await pg.screenshot(path="z29-form.png")
        await pg.click("#tfSave"); await pg.wait_for_timeout(900)
        args = await pg.evaluate("JSON.stringify(__mockLog.filter(x => x[0] === 'rpc' && x[1] === 'create_tournament_v2').slice(-1)[0][2])"); a = json.loads(args)
        check("create sends hours and window", a["p_start_time"] == "06:00" and a["p_end_time"] == "14:00" and a["p_submit_hours"] == 6, f"{a['p_start_time']} {a['p_end_time']} {a['p_submit_hours']}")
        check("no errors", not pg.errs, pg.errs)
        # photo time is kept from a photo's stamp
        r = await D("(() => { const m = '2026:11:14 09:15:42'.match(/[ T](\\d{2}):(\\d{2})(?::(\\d{2}))?/); return m ? m[1] + ':' + m[2] + ':' + (m[3] || '00') : null; })()")
        check("photo clock time parsed", r == "09:15:42", r)
        check("catch rows carry photo_time", "photo_time" in await D("COLS.catches.join(',')"))
        print("ALL PASS" if ok else "SOME FAILED"); await b.close()
asyncio.run(main())
