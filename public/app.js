const els = {
  statusDot: document.querySelector("#system-status-dot"),
  status: document.querySelector("#system-status"),
  lastUpdated: document.querySelector("#last-updated"),
  alerts: document.querySelector("#alerts"),
  soundLevel: document.querySelector("#sound-level"),
  soundTrend: document.querySelector("#sound-trend"),
  sound24h: document.querySelector("#sound-24h"),
  soundRange: document.querySelector("#sound-range"),
  soundTime: document.querySelector("#sound-time"),
  soundChart: document.querySelector("#sound-chart"),
  waveHeight: document.querySelector("#wave-height"),
  waterTemp: document.querySelector("#water-temp"),
  wavePeriod: document.querySelector("#wave-period"),
  waveDirection: document.querySelector("#wave-direction"),
  waveChart: document.querySelector("#wave-chart"),
  swell: document.querySelector("#swell"),
  windWave: document.querySelector("#wind-wave"),
  marineAir: document.querySelector("#marine-air"),
  weatherTemp: document.querySelector("#weather-temp"),
  weatherSummary: document.querySelector("#weather-summary"),
  weatherWind: document.querySelector("#weather-wind"),
  weatherHumidity: document.querySelector("#weather-humidity"),
  weatherPressure: document.querySelector("#weather-pressure"),
  weatherRain: document.querySelector("#weather-rain"),
  weatherNote: document.querySelector("#weather-note"),
  tideHeight: document.querySelector("#tide-height"),
  tideType: document.querySelector("#tide-type"),
  tideCountdown: document.querySelector("#tide-countdown"),
  tideNextTime: document.querySelector("#tide-next-time"),
  tideStation: document.querySelector("#tide-station"),
  tideDatum: document.querySelector("#tide-datum"),
  tideList: document.querySelector("#tide-list"),
  tideNote: document.querySelector("#tide-note"),
  buoyMap: document.querySelector("#buoy-map"),
  buoyList: document.querySelector("#buoy-list"),
  buoyCount: document.querySelector("#buoy-count"),
  buoyRange: document.querySelector("#buoy-range"),
  buoyNote: document.querySelector("#buoy-note")
};

const mapState = {
  map: null,
  layer: null,
  referenceLayer: null,
  markers: new Map(),
  stations: new Map(),
  selectedStationId: null
};

const fmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short"
});

const oneDecimal = (value) => Number.isFinite(value) ? value.toFixed(1) : "--";
const zeroDecimal = (value) => Number.isFinite(value) ? Math.round(value).toString() : "--";
const signed = (value, unit) => {
  if (!Number.isFinite(value)) return "--";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)} ${unit}`;
};

function setText(node, value) {
  if (node) node.textContent = value;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;"
  })[char]);
}

function tempColor(temp) {
  if (!Number.isFinite(temp)) return "#66756f";
  if (temp < 52) return "#0a4d65";
  if (temp < 56) return "#0f7a83";
  if (temp < 60) return "#2f7d5c";
  return "#d9672b";
}

function ageLabel(hours) {
  if (!Number.isFinite(hours)) return "unknown age";
  if (hours < 1) return "fresh";
  if (hours < 24) return `${Math.round(hours)}h old`;
  return `${Math.round(hours / 24)}d old`;
}

function timeUntilLabel(time) {
  const diffMs = new Date(time).getTime() - Date.now();
  if (!Number.isFinite(diffMs)) return "--";
  if (diffMs <= 0) return "now";
  const hours = Math.floor(diffMs / (60 * 60 * 1000));
  const minutes = Math.round((diffMs % (60 * 60 * 1000)) / (60 * 1000));
  if (hours <= 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

function shortTickLabel(time) {
  const date = new Date(time);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    month: "numeric",
    day: "numeric"
  }).format(date);
}

function renderSparkline(svg, points, key, color = "#0f5d6d", fill = "rgba(15, 93, 109, 0.14)", unit = "") {
  if (!svg || !Array.isArray(points) || points.length < 2) {
    if (svg) svg.innerHTML = "";
    return;
  }

  const values = points.map((point) => point[key]).filter(Number.isFinite);
  if (!values.length) {
    svg.innerHTML = "";
    return;
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = max - min || 1;
  const width = 640;
  const height = 180;
  const padTop = 18;
  const padRight = 18;
  const padBottom = 30;
  const padLeft = 54;
  const usableW = width - padLeft - padRight;
  const usableH = height - padTop - padBottom;

  const coords = points.map((point, index) => {
    const value = Number.isFinite(point[key]) ? point[key] : min;
    const x = padLeft + (index / (points.length - 1)) * usableW;
    const y = padTop + (1 - (value - min) / spread) * usableH;
    return [x, y];
  });

  const line = coords.map(([x, y], index) => `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`).join(" ");
  const baselineY = height - padBottom;
  const area = `${line} L ${coords.at(-1)[0].toFixed(2)} ${baselineY} L ${coords[0][0].toFixed(2)} ${baselineY} Z`;
  const yTicks = [max, min + spread / 2, min];
  const xTickCount = 7;
  const xTicks = Array.from({ length: xTickCount }, (_, index) => {
    const ratio = xTickCount === 1 ? 0 : index / (xTickCount - 1);
    const pointIndex = Math.min(points.length - 1, Math.round(ratio * (points.length - 1)));
    return {
      x: padLeft + ratio * usableW,
      label: shortTickLabel(points[pointIndex]?.time)
    };
  });
  const gridColor = color === "#bfe8df" ? "rgba(238, 251, 247, 0.24)" : "rgba(19, 36, 34, 0.16)";
  const labelColor = color === "#bfe8df" ? "rgba(238, 251, 247, 0.72)" : "rgba(19, 36, 34, 0.56)";

  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.innerHTML = `
    ${yTicks.map((value) => {
      const y = padTop + (1 - (value - min) / spread) * usableH;
      return `
        <line class="chart-grid-line" x1="${padLeft}" x2="${width - padRight}" y1="${y.toFixed(2)}" y2="${y.toFixed(2)}" stroke="${gridColor}"></line>
        <text class="chart-label" x="${padLeft - 10}" y="${(y + 4).toFixed(2)}" text-anchor="end" fill="${labelColor}">${oneDecimal(value)}${unit}</text>
      `;
    }).join("")}
    ${xTicks.map((tick, index) => `
      <line class="chart-grid-line vertical" x1="${tick.x.toFixed(2)}" x2="${tick.x.toFixed(2)}" y1="${padTop}" y2="${baselineY}" stroke="${gridColor}"></line>
      <text class="chart-label chart-x-label" x="${tick.x.toFixed(2)}" y="${height - 9}" text-anchor="${index === 0 ? "start" : index === xTicks.length - 1 ? "end" : "middle"}" fill="${labelColor}">${escapeHtml(tick.label)}</text>
    `).join("")}
    <path d="${area}" fill="${fill}"></path>
    <path d="${line}" fill="none" stroke="${color}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"></path>
    <circle cx="${coords.at(-1)[0].toFixed(2)}" cy="${coords.at(-1)[1].toFixed(2)}" r="7" fill="${color}"></circle>
  `;
}

function ensureBuoyMap(reference) {
  if (!els.buoyMap) return null;

  if (!window.L) {
    els.buoyMap.innerHTML = `
      <div class="map-fallback">
        <div>
          <strong>Map tiles unavailable</strong>
          <span>The buoy list still shows live station temperatures.</span>
        </div>
      </div>
    `;
    return null;
  }

  if (mapState.map) return mapState.map;

  mapState.map = window.L.map(els.buoyMap, {
    scrollWheelZoom: false,
    zoomControl: true
  }).setView([reference?.lat ?? 36.55, reference?.lon ?? -75.87], 8);

  window.L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(mapState.map);

  mapState.layer = window.L.layerGroup().addTo(mapState.map);
  mapState.referenceLayer = window.L.layerGroup().addTo(mapState.map);
  return mapState.map;
}

function markerHtml(station) {
  const temp = station.latest?.waterTempF;
  const label = Number.isFinite(temp) ? `${oneDecimal(temp)}°` : "--";
  return `
    <div class="buoy-marker ${station.isStale ? "stale" : ""} ${mapState.selectedStationId === station.id ? "selected" : ""}" style="background:${tempColor(temp)}">
      <strong>${escapeHtml(label)}</strong>
      <span>${escapeHtml(station.id)}</span>
    </div>
  `;
}

function popupHtml(station) {
  const temp = station.latest?.waterTempF;
  const wave = station.latest?.waveHeightFt;
  const distance = station.distanceFromVaNcLineMiles;
  return `
    <strong>${escapeHtml(station.id)} · ${escapeHtml(station.name)}</strong>
    <span>${Number.isFinite(temp) ? `${oneDecimal(temp)} °F water` : "Water temp unavailable"}</span>
    <span>${Number.isFinite(wave) ? `${oneDecimal(wave)} ft waves` : "Wave height unavailable"}</span>
    <span>${ageLabel(station.latestAgeHours)} · ${Number.isFinite(distance) ? `${oneDecimal(distance)} mi from VA/NC line` : "distance unknown"}</span>
  `;
}

function renderLeafletBuoys(buoys, stations) {
  const map = ensureBuoyMap(buoys.reference);
  if (!map || !mapState.layer || !mapState.referenceLayer) return;

  mapState.layer.clearLayers();
  mapState.referenceLayer.clearLayers();
  mapState.markers.clear();
  mapState.stations = new Map(stations.map((station) => [station.id, station]));

  const reference = buoys.reference;
  if (reference?.lat && reference?.lon) {
    const referenceIcon = window.L.divIcon({
      className: "leaflet-div-icon",
      html: `<div class="line-marker">${escapeHtml(reference.name || "VA/NC line")}</div>`,
      iconSize: [120, 32],
      iconAnchor: [60, 16]
    });
    window.L.marker([reference.lat, reference.lon], { icon: referenceIcon, interactive: false }).addTo(mapState.referenceLayer);
    window.L.circle([reference.lat, reference.lon], {
      radius: 1609,
      color: "#d9672b",
      weight: 2,
      opacity: 0.75,
      fillColor: "#d9672b",
      fillOpacity: 0.08
    }).addTo(mapState.referenceLayer);
  }

  const bounds = [];
  for (const station of stations) {
    if (!Number.isFinite(station.lat) || !Number.isFinite(station.lon)) continue;
    bounds.push([station.lat, station.lon]);

    const icon = window.L.divIcon({
      className: "leaflet-div-icon",
      html: markerHtml(station),
      iconSize: [92, 58],
      iconAnchor: [46, 58],
      popupAnchor: [0, -54]
    });

    const marker = window.L.marker([station.lat, station.lon], { icon })
      .bindPopup(popupHtml(station))
      .on("click", () => selectBuoyStation(station.id, { pan: false }))
      .addTo(mapState.layer);
    mapState.markers.set(station.id, marker);
  }

  if (reference?.lat && reference?.lon) bounds.push([reference.lat, reference.lon]);
  if (bounds.length) {
    map.fitBounds(bounds, { padding: [30, 30], maxZoom: 8 });
  }

  setTimeout(() => map.invalidateSize(), 0);
}

function updateBuoySelection() {
  for (const [stationId, marker] of mapState.markers) {
    const station = mapState.stations.get(stationId);
    if (!station) continue;
    marker.setIcon(window.L.divIcon({
      className: "leaflet-div-icon",
      html: markerHtml(station),
      iconSize: [92, 58],
      iconAnchor: [46, 58],
      popupAnchor: [0, -54]
    }));
  }

  els.buoyList?.querySelectorAll(".buoy-list-item").forEach((item) => {
    item.classList.toggle("selected", item.dataset.stationId === mapState.selectedStationId);
  });
}

function selectBuoyStation(stationId, options = {}) {
  const marker = mapState.markers.get(stationId);
  const station = mapState.stations.get(stationId);
  if (!marker || !station || !mapState.map) return;

  mapState.selectedStationId = stationId;
  updateBuoySelection();

  const latLng = marker.getLatLng();
  if (options.pan !== false) {
    mapState.map.flyTo(latLng, Math.max(mapState.map.getZoom(), 8), { duration: 0.55 });
  }
  marker.openPopup();
}

function renderAlerts(errors) {
  const messages = Object.entries(errors || {})
    .filter(([, value]) => value)
    .map(([key, value]) => `${key}: ${value}`);

  els.alerts.hidden = messages.length === 0;
  els.alerts.innerHTML = messages.map((message) => `<div class="alert">${message}</div>`).join("");
}

function renderBuoyMap(buoys) {
  if (!buoys?.stations?.length) {
    setText(els.buoyCount, "--");
    setText(els.buoyRange, "--");
    setText(els.buoyNote, "No NOAA buoy station data is available right now.");
    if (els.buoyList) els.buoyList.innerHTML = "";
    if (mapState.layer) mapState.layer.clearLayers();
    return;
  }

  const stations = buoys.stations;
  setText(els.buoyCount, zeroDecimal(buoys.freshStationCount));
  setText(els.buoyRange, buoys.temperatureRangeF
    ? `${oneDecimal(buoys.temperatureRangeF.min)}-${oneDecimal(buoys.temperatureRangeF.max)}°`
    : "--");
  setText(els.buoyNote, "Markers are plotted from NDBC station coordinates. Faded markers are stale reports older than 24 hours.");
  renderLeafletBuoys(buoys, stations);

  if (els.buoyList) {
    els.buoyList.innerHTML = stations.map((station) => {
      const temp = station.latest?.waterTempF;
      const wave = station.latest?.waveHeightFt;
      const distance = station.distanceFromVaNcLineMiles;
      const status = station.error
        ? station.error
        : `${ageLabel(station.latestAgeHours)} · ${Number.isFinite(distance) ? `${oneDecimal(distance)} mi from VA/NC line` : "distance unknown"}`;
      return `
        <button class="buoy-list-item" type="button" data-station-id="${escapeHtml(station.id)}" aria-label="Show ${escapeHtml(station.name)} on the buoy map">
          <div>
            <strong>${escapeHtml(station.id)} · ${escapeHtml(station.name)}</strong>
            <span>${escapeHtml(status)}</span>
          </div>
          <div>
            <strong class="buoy-temp">${Number.isFinite(temp) ? `${oneDecimal(temp)}°` : "--"}</strong>
            <span>${Number.isFinite(wave) ? `${oneDecimal(wave)} ft waves` : station.zone}</span>
          </div>
        </button>
      `;
    }).join("");
    els.buoyList.querySelectorAll(".buoy-list-item").forEach((item) => {
      item.addEventListener("click", () => selectBuoyStation(item.dataset.stationId));
    });
    updateBuoySelection();
  }
}

function renderTide(tide) {
  if (!tide?.next) {
    setText(els.tideHeight, "--");
    setText(els.tideType, "--");
    setText(els.tideCountdown, "--");
    setText(els.tideNextTime, "--");
    setText(els.tideStation, "--");
    setText(els.tideDatum, "--");
    setText(els.tideNote, "No Atlantic tide predictions are available right now.");
    if (els.tideList) els.tideList.innerHTML = "";
    return;
  }

  setText(els.tideHeight, oneDecimal(tide.next.valueFt));
  setText(els.tideType, `${tide.next.type} tide`);
  setText(els.tideCountdown, `in ${timeUntilLabel(tide.next.time)}`);
  setText(els.tideNextTime, fmt.format(new Date(tide.next.time)));
  setText(els.tideStation, tide.station?.name || "--");
  setText(els.tideDatum, tide.station?.datum || "--");
  setText(els.tideNote, `${tide.station?.name || "Duck Pier"} is the closest verified NOAA Atlantic tide station found for Carova Beach, about ${oneDecimal(tide.distanceFromCarovaMiles)} mi south.`);

  if (els.tideList) {
    els.tideList.innerHTML = (tide.upcoming || []).slice(0, 4).map((prediction) => `
      <div class="tide-item">
        <strong>${escapeHtml(prediction.type)}</strong>
        <span>${escapeHtml(fmt.format(new Date(prediction.time)))}</span>
        <strong>${escapeHtml(oneDecimal(prediction.valueFt))} ft</strong>
      </div>
    `).join("");
  }
}

function render(data) {
  const { sound, marine, weather, buoys, tide, errors } = data;

  setText(els.status, errors && Object.keys(errors).length ? "Partial live data" : "All live feeds loaded");
  els.statusDot.classList.toggle("ok", !(errors && Object.keys(errors).length));
  setText(els.lastUpdated, `Updated ${fmt.format(new Date(data.generatedAt))}`);
  renderAlerts(errors);

  if (sound?.latest) {
    setText(els.soundLevel, oneDecimal(sound.latest.value));
    setText(els.sound24h, signed(sound.change24h, "ft"));
    setText(els.soundRange, `${oneDecimal(sound.range?.min)}-${oneDecimal(sound.range?.max)} ft`);
    setText(els.soundTime, fmt.format(new Date(sound.latest.time)));
    setText(els.soundTrend, Number.isFinite(sound.change24h) ? (sound.change24h >= 0 ? "Rising" : "Falling") : "--");
    els.soundTrend.classList.toggle("down", sound.change24h < 0);
    renderSparkline(els.soundChart, sound.series, "value", "#0f5d6d", "rgba(15, 93, 109, 0.14)", "ft");
  }

  if (marine?.latest) {
    setText(els.waveHeight, oneDecimal(marine.latest.waveHeightFt));
    setText(els.waterTemp, oneDecimal(marine.latest.waterTempF));
    setText(els.wavePeriod, `${zeroDecimal(marine.latest.dominantPeriodSec)} sec dominant period`);
    setText(els.waveDirection, `${marine.latest.meanWaveDirectionText || "--"} mean direction`);
    setText(els.marineAir, `${oneDecimal(marine.latest.airTempF)} °F`);
    setText(els.swell, marine.spectral ? `${oneDecimal(marine.spectral.swellHeightFt)} ft @ ${oneDecimal(marine.spectral.swellPeriodSec)} sec ${marine.spectral.swellDirection || ""}` : "--");
    setText(els.windWave, marine.spectral ? `${oneDecimal(marine.spectral.windWaveHeightFt)} ft @ ${oneDecimal(marine.spectral.windWavePeriodSec)} sec ${marine.spectral.windWaveDirection || ""}` : "--");
    renderSparkline(els.waveChart, marine.series, "waveHeightFt", "#bfe8df", "rgba(191, 232, 223, 0.18)", "ft");
  }

  if (weather) {
    setText(els.weatherTemp, zeroDecimal(weather.temperatureF));
    setText(els.weatherSummary, weather.summary || "--");
    setText(els.weatherWind, weather.wind || "--");
    setText(els.weatherHumidity, Number.isFinite(weather.humidity) ? `${zeroDecimal(weather.humidity)}%` : "--");
    setText(els.weatherPressure, Number.isFinite(weather.pressureInHg) ? `${weather.pressureInHg.toFixed(2)} in` : "--");
    setText(els.weatherRain, Number.isFinite(weather.precipChance) ? `${zeroDecimal(weather.precipChance)}%` : "--");
    setText(els.weatherNote, weather.note || "");
  }

  renderTide(tide);
  renderBuoyMap(buoys);
}

async function load() {
  try {
    const response = await fetch("/api/snapshot", { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`Dashboard API returned ${response.status}`);
    render(await response.json());
  } catch (error) {
    setText(els.status, "Unable to load data");
    setText(els.lastUpdated, error.message);
    els.statusDot.classList.remove("ok");
    renderAlerts({ dashboard: error.message });
  }
}

load();
setInterval(load, 5 * 60 * 1000);
