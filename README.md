# Coulee

Wisconsin fly fishing map and log (repository name: Wisconsin-Fly-Log).

A fly fishing map and log for Wisconsin: county map with every named creek and lake,
DNR trout stream classes, regulations and public land, plus your spots, catches, trips,
stats, and a friends feed with leaderboards.

Open it on your phone, sign in, and use **Share → Add to Home Screen** to install it.

## How it's built
- Static site served by GitHub Pages; no build server.
- Everything is edited in `src/`: the scripts in `src/*.js`, and the page, styles, service worker and terms in `src/static/`.
  `python3 build.py --beta N` builds test version N into `beta/`. The files at the site root (`index.html`, `css/app.css`,
  `sw.js`, `js/app.js`) are the live app; they change only when a test version is released, so never edit them by hand.
- Accounts, catches, trips and photos live in Supabase (row-level security keeps each
  angler's data private unless they share it with friends).
- `data/` holds Wisconsin DNR hydrography, trout and public-land data, split by county. `data/water/hd/` has the detailed DNR 24K creek lines (within ~3 m) that load when zoomed in to level 12+.
- `sw.js` keeps the app and opened counties available offline.
