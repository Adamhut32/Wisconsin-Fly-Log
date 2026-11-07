# Coulee

Wisconsin fly fishing map and log (repository name: Wisconsin-Fly-Log).

A fly fishing map and log for Wisconsin: county map with every named creek and lake,
DNR trout stream classes, regulations and public land, plus your spots, catches, trips,
stats, and a friends feed with leaderboards.

Open it on your phone, sign in, and use **Share → Add to Home Screen** to install it.

## How it's built
- Static site served by GitHub Pages; no build server.
- `src/*.js` is joined into `js/app.js` by `python3 build.py`. Edit `src/`, then rebuild.
- Accounts, catches, trips and photos live in Supabase (row-level security keeps each
  angler's data private unless they share it with friends).
- `data/` holds Wisconsin DNR hydrography, trout and public-land data, split by county.
- `sw.js` keeps the app and opened counties available offline.
