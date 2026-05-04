# TODO

## Data and Caching

- [x] Keep `/api/snapshot` backed by SQLite and limit external source refreshes to once every two minutes.
- [x] Show when the dashboard is serving cached data versus a freshly fetched snapshot.
- [x] Add NDBC realtime extras where reported: wind, gust, pressure, dew point, visibility, pressure tendency, and tide.
- [x] Add NWS hourly forecast data focused on Carova 4x4 decisions: temperature, rain chance, wind, and short forecast.
- [ ] Add NWS alerts for the Carova/VA-NC-line area.
- [ ] Add richer NDBC wave-spectrum products if surf quality needs more detail: raw spectral energy and directional wave files.
- [ ] Add NOAA CO-OPS station metadata for Sandbridge: datums, harmonic constituents, and prediction offsets.
- [ ] Review whether nearby active CO-OPS or NDBC stations can improve northern OBX wind, water temperature, or surge context.
