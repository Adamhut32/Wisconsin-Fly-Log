# DNR data sources for Coulee

Where each map layer comes from, so the monthly refresh (`tools/dnr_refresh.py`, `.github/workflows/dnr-refresh.yml`) can be extended.

| App data | Status | DNR source |
|---|---|---|
| Detailed creek lines `data/water/hd/` | **Refreshed monthly** | `arcgis2/rest/services/TS_AGOL_STAGING_SERVICES/EN_AGOL_STAGING_SurfaceWater_WTM/MapServer/2` (24K Flowlines). Filter: `HYDROTYPE IN (503,508) AND (RIVER_SYS_NAME <> 'Unnamed' OR STREAM_ORDER >= 2)`. 508 = Stream/River single-line, 503 = centerline. |
| Light creek lines `data/water/{county}.json` `s` | Not refreshed | `arcgis/rest/services/ER_Biotics/ER_Biotics_WGS84_Hydro/MapServer/1` (simplified copy of the 24K layer) |
| Trout regulations `data/water/trout/{county}.json` `r` | Source confirmed, not wired up | `arcgis/rest/services/FM_Trout/FM_TROUT_REGS_WTM_Ext/MapServer/0` (streams; fields STREAM, REGCAT, BAG_LMT, SEASON_TXT, EARLY_SEASON_TXT, GEAR_RESTRICTIONS, SPECIALREG1). Layer 1 = lake/pond regs, layer 2 = county base regs. County row format: `[STREAM, REGCAT, BAG_LMT, SEASON_TXT, EARLY_SEASON_TXT, GEAR ('N/A' -> null), SPECIALREG1, paths]` |
| Trout classes `t` and spring ponds `p` | Likely source, fields unconfirmed | `arcgis/rest/services/WT_SWDV/WY_FISHERIES_WATERS/MapServer/8` ("Trout Waters", Class I/II/III). Statewide original had `['name', 'CLASS II', miles, 'ERW'/'ORW'/null, paths]`; county rows use class 1/2/3. |
| DNR lands `data/access/` kinds `dnr` / `dnre` | Likely source | `arcgis/rest/services/LF_DML/LF_AGOL_STAGING_WTM_Ext/MapServer/1` (parcels: PROP_NAME_LABEL, TRANS_TYPE_CODE, EASE_USE_CODE, FUNCTION_MGT_CODE, GIS_ACRES). Rule for `dnr` (owned) vs `dnre` (easement) still to be worked out from TRANS_TYPE_CODE / EASE_USE_CODE against the current files. |
| Trout easements `trout`, county forests `cf`, national forest `usfs`, federal/NPS `nps` | Sources not found yet | Original fields: trout easements STREAM_NAM, GRANTOR, EXPIREDATE; county forest FR_PROP_NAME; USFS NAME1; NPS PROP_NAME, PROP_TYPE. Candidates: `LF_DML/LF_DNR_MGD_Federal_WTM_Ext`, `LF_DML/LF_DNR_PUBLIC_LAND_WTM_Ext`. |

Notes
- The cloud session can't open most dnrmaps.wi.gov pages directly; the founder's computer browser (desktop app) or the GitHub runner can.
- Every new source must be compared canonically against the current files first (zero false changes) before it's added to the refresh.
