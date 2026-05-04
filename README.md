# OBX Conditions

An at-a-glance conditions dashboard for the northern Outer Banks, focused on the things that actually change local decisions: wind-driven Currituck Sound water levels, nearshore surf, offshore water temperatures, and hyperlocal Carova-area weather.

The current app is intentionally small: a Bun server, static frontend assets, live public data fetches, and a local SQLite history store. No frontend framework is required yet.

## What It Shows

- **Currituck Sound level** from USGS gage height at Corolla, useful because inland water levels here are wind-driven rather than tide-driven in a simple way.
- **Duck FRF surf conditions** from NOAA NDBC station `44056`, including wave height, dominant period, water temperature, air temperature, swell, and wind-wave breakdown.
- **Northern OBX buoy water-temperature map** with nearby, northern, and offshore NOAA stations plotted around the VA/NC line oceanfront.
- **Carova Atlantic tide guidance** from NOAA CO-OPS high/low predictions at Duck Pier, the closest verified Atlantic tide station currently used for Carova Beach.
- **Carova Beach Fire Department weather** using the Currituck WeatherSTEM public portal for station temperature and NWS fallback data for forecast/observation fields.
- **Local history** persisted to SQLite so repeated live fetches build a local dataset over time.

## Tech Stack

- **Runtime:** Bun
- **Server:** `Bun.serve`
- **Database:** SQLite via Bun's built-in `bun:sqlite`
- **Frontend:** Static HTML/CSS/vanilla JS
- **Charts/maps:** Inline SVG sparklines and a Leaflet/OpenStreetMap buoy map
- **Generated art:** Project-local background image in `public/images/`

## Project Structure

```text
.
├── public/
│   ├── app.js                         # Client rendering and polling
│   ├── index.html                     # Dashboard markup
│   ├── styles.css                     # Visual system, cards, map, responsive layout
│   └── images/
│       └── obx-atmospheric-background.png
├── src/
│   ├── db.ts                          # SQLite schema, persistence, history queries
│   └── server.ts                      # Live data fetches, API routes, static serving
├── .env.example
├── package.json
└── README.md
```

Runtime-created local database files live under `data/` by default and are ignored by git.

## Data Sources

### Sound Level

- Source: USGS NWIS Instantaneous Values
- Station: `02043433`
- Name: Currituck Sound on east bank at Corolla, NC
- Data used: `00065` gage height in feet
- URL: `https://waterservices.usgs.gov/nwis/iv/`

### Duck FRF Surf

- Source: NOAA National Data Buoy Center
- Station: `44056`
- Name: Duck FRF, NC
- Data used: realtime observations and spectral wave summaries
- Realtime feed: `https://www.ndbc.noaa.gov/data/realtime2/44056.txt`
- Spectral feed: `https://www.ndbc.noaa.gov/data/realtime2/44056.spec`

### Buoy Temperature Map

The buoy map is centered conceptually on the VA/NC line oceanfront. It uses station coordinates from NOAA, renders them on a Leaflet map with OpenStreetMap tiles, and plots latest available water temperature.

Included stations:

| Station | Name | Role |
| --- | --- | --- |
| `44099` | Cape Henry, VA | Northern comparison |
| `44014` | Virginia Beach 64 NM East | Offshore/northern comparison |
| `44079` | OOI Pioneer Northern Surface Mooring | Farther offshore |
| `41082` | OOI Pioneer Central Surface Mooring | Farther offshore |
| `41083` | OOI Pioneer Southern Surface Mooring | Farther offshore |
| `44056` | Duck FRF | Near northern OBX reference |
| `44100` | Duck FRF 26m | Nearshore reference, may be stale |
| `44086` | Nags Head, NC | Southern reference |

Map markers fade when the latest station reading is older than 24 hours.

### Atlantic Tides

- Source: NOAA Center for Operational Oceanographic Products and Services
- Station: `8651370`
- Name: Duck Pier, NC
- Data used: high/low tide predictions in feet relative to MLLW
- API: `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter`
- Station page: `https://tidesandcurrents.noaa.gov/stationhome.html?id=8651370`

The dashboard labels this as tide guidance because Duck Pier is roughly 24 miles south of the Carova oceanfront reference point. It is the closest verified NOAA Atlantic tide station currently wired into the MVP.

### Carova Weather

- Source: Currituck WeatherSTEM public portal
- Station: CCEM Carova Beach Fire Department
- Public station page: `https://currituck.weatherstem.com/ccemcarovabeach`
- Fallback/enrichment: National Weather Service API point forecast/nearest official observations near Carova
- Note: Full WeatherSTEM sensor API access requires an API key.

## Running Locally

Install Bun if needed, then:

```bash
bun run dev
```

Open:

```text
http://localhost:3000
```

If port `3000` is busy:

```bash
PORT=3014 bun run start
```

## Configuration

Copy the example env file if you need local overrides:

```bash
cp .env.example .env
```

Supported variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | Local HTTP server port |
| `DB_PATH` | `data/obx.sqlite` | SQLite database path |
| `WEATHERSTEM_API_KEY` | empty | Optional WeatherSTEM API access |

When `WEATHERSTEM_API_KEY` is not set, the app still works by using public WeatherSTEM temperature text plus NWS weather data.

## API Endpoints

### `GET /api/snapshot`

Fetches live data, persists it to SQLite, and returns the current dashboard payload.

This endpoint intentionally returns lightweight chart/map data. Full source histories are used for persistence but omitted from the response.

### `GET /api/history`

Reads local SQLite history. Query parameters:

- `kind`: history dataset
- `limit`: row limit, clamped from `1` to `2000`

Supported kinds:

| Kind | Description |
| --- | --- |
| `sound` | Currituck Sound gage-height observations |
| `marine` | Duck FRF realtime buoy observations |
| `spectral` | Duck FRF spectral wave summaries |
| `buoys` | Northern/offshore buoy map observations |
| `tides` | NOAA CO-OPS Atlantic high/low tide predictions |
| `weather` | Carova-area weather snapshots |
| `snapshots` | Compact dashboard snapshot records |

Examples:

```bash
curl 'http://localhost:3000/api/history?kind=buoys&limit=25'
curl 'http://localhost:3000/api/history?kind=tides&limit=12'
curl 'http://localhost:3000/api/history?kind=sound&limit=500'
```

### `GET /api/db/stats`

Returns row counts and the active SQLite path.

```bash
curl 'http://localhost:3000/api/db/stats'
```

## SQLite History

SQLite is initialized automatically on first run. The schema is in [src/db.ts](src/db.ts).

Tables:

| Table | Purpose |
| --- | --- |
| `snapshots` | Compact raw dashboard snapshot for replay/debugging |
| `sound_levels` | Normalized USGS gage-height rows |
| `marine_observations` | Normalized Duck FRF realtime rows |
| `marine_spectral` | Normalized Duck FRF spectral rows |
| `buoy_observations` | Normalized multi-buoy water temp rows |
| `tide_predictions` | NOAA CO-OPS high/low Atlantic tide predictions |
| `weather_observations` | Weather snapshots for Carova area |

Upserts are idempotent for source observations, so repeated polling does not duplicate the same station/time rows.

Local database files are ignored:

```text
data/*.sqlite
data/*.sqlite-shm
data/*.sqlite-wal
```

## Developer Checks

Run a live aggregation check without starting the HTTP server:

```bash
bun run check
```

The check command uses an isolated SQLite file under `/private/tmp` so it can run while a dev server is using the default local history database.

Expected shape:

```json
{
  "ok": true,
  "hasSound": true,
  "hasMarine": true,
  "hasWeather": true,
  "hasBuoys": true,
  "hasTide": true,
  "errors": {}
}
```

Inspect local database stats:

```bash
bun -e "import { getDatabaseStats } from './src/db.ts'; console.log(JSON.stringify(getDatabaseStats(), null, 2));"
```

## Frontend Notes

The frontend is deliberately framework-free:

- `public/app.js` polls `/api/snapshot` every 5 minutes.
- Sparkline charts are rendered as inline SVG paths.
- The buoy map uses Leaflet with OpenStreetMap tiles, station-coordinate markers, popups, and a one-mile VA/NC-line reference circle.
- The visual design uses glassy cards over a generated OBX background with readability overlays.

If the UI grows, likely next steps are:

- Move rendering into small modules.
- Add a typed shared API contract.
- Move external browser dependencies into bundled assets if offline/local-network operation becomes important.

## Extension Ideas

- Add NOAA CO-OPS tide/current/water temperature stations where useful.
- Add wind direction overlays for sound-level interpretation.
- Add cached fetch windows to avoid hitting live sources on every dashboard refresh.
- Add historical charts backed by SQLite instead of only current-source windows.
- Add admin controls for station inclusion/exclusion.
- Add station health indicators and last-success timestamps.

## Operational Notes

- External data is public and can be temporarily unavailable.
- The map uses OpenStreetMap tiles from `tile.openstreetmap.org` and Leaflet assets from `unpkg.com`; if those browser-side assets are unavailable, the station list still renders.
- NOAA stations may report `MM` for missing values; parsers convert those to empty fields.
- `44100` often has older data; it is retained because it is useful when reporting, but stale state is shown.
- The app currently persists on every `/api/snapshot` request. If traffic increases, add a short server-side cache interval.
