# Coulee tests
Browser tests that run the app against a stand-in server, so nothing touches real accounts or data.

Setup (once): `pip install playwright && python -m playwright install chromium`

Run:
```
cd <repo root> && python3 -m http.server 8790 &      # serve the site
cd tools/tests && python3 t34a.py                     # each test prints PASS/FAIL lines and ALL PASS at the end
```
Tests open the test version (`/beta/`), so build it first: `python3 build.py --beta N --note wip`.

| Test | Checks |
|---|---|
| t26a–e | county taps, double notifications, photos, phone log sheet |
| t27a | username sign-in, Before Coulee off the leaderboard |
| t28a | trout class / open-now filters, class help, titles |
| t29a | tournament start/end times and send-in window |
| t30a | boat landings, road crossings, lake facts, stocking, stream flows |
| t31a | public land when zoomed in, tapping flow pins, iPhone text-box zoom |
| t32a | Apple Maps links, sharing with chosen friends, friend pages |
| t34a | season flags, recap, challenges, streak, counties, measure along a creek |
| perf.py | map speed on a slowed-down phone (`python3 perf.py beta`); compare before/after a change |
| shots30.py, sizes.py | screenshots and download sizes |
| tflow.py | tap a stream-flow pin with stand-in USGS data |

`base26.py` is the shared helper; `mock-supabase.js` is the stand-in server (edit its data at the top to add cases);
`patch.js` signs in a stand-in founder account. `pg.dbg("any app code")` runs code inside the app during a test.
For checks against the real USGS and weather services, run the "Live check of outside services" GitHub workflow.
