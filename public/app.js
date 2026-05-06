const els = {
  statusDot: document.querySelector("#system-status-dot"),
  status: document.querySelector("#system-status"),
  lastUpdated: document.querySelector("#last-updated"),
  alerts: document.querySelector("#alerts"),
  soundLevel: document.querySelector("#sound-level"),
  soundTrend: document.querySelector("#sound-trend"),
  sound24h: document.querySelector("#sound-24h"),
  soundRangeLabel: document.querySelector("#sound-range-label"),
  soundRange: document.querySelector("#sound-range"),
  soundTime: document.querySelector("#sound-time"),
  soundChart: document.querySelector("#sound-chart"),
  soundChartControls: document.querySelector("#sound-chart-controls"),
  windPredictionMode: document.querySelector("#wind-prediction-mode"),
  windPredictionList: document.querySelector("#wind-prediction-list"),
  waveHeight: document.querySelector("#wave-height"),
  waterTemp: document.querySelector("#water-temp"),
  wavePeriod: document.querySelector("#wave-period"),
  waveDirection: document.querySelector("#wave-direction"),
  waveChart: document.querySelector("#wave-chart"),
  waveChartControls: document.querySelector("#wave-chart-controls"),
  swell: document.querySelector("#swell"),
  windWave: document.querySelector("#wind-wave"),
  marineAir: document.querySelector("#marine-air"),
  marineWind: document.querySelector("#marine-wind"),
  marinePressure: document.querySelector("#marine-pressure"),
  marineDew: document.querySelector("#marine-dew"),
  weatherTemp: document.querySelector("#weather-temp"),
  weatherSummary: document.querySelector("#weather-summary"),
  weatherWind: document.querySelector("#weather-wind"),
  weatherHumidity: document.querySelector("#weather-humidity"),
  weatherPressure: document.querySelector("#weather-pressure"),
  weatherRain: document.querySelector("#weather-rain"),
  forecastTitle: document.querySelector("#forecast-title"),
  forecastControls: document.querySelector("#forecast-controls"),
  forecastList: document.querySelector("#forecast-list"),
  weatherNote: document.querySelector("#weather-note"),
  tideHeight: document.querySelector("#tide-height"),
  tideType: document.querySelector("#tide-type"),
  tideCountdown: document.querySelector("#tide-countdown"),
  tideNextTime: document.querySelector("#tide-next-time"),
  tideStation: document.querySelector("#tide-station"),
  tideDatum: document.querySelector("#tide-datum"),
  tideChart: document.querySelector("#tide-chart"),
  tideList: document.querySelector("#tide-list"),
  tideNote: document.querySelector("#tide-note"),
  buoyMap: document.querySelector("#buoy-map"),
  buoyList: document.querySelector("#buoy-list"),
  buoyCount: document.querySelector("#buoy-count"),
  buoyRange: document.querySelector("#buoy-range"),
  buoyNote: document.querySelector("#buoy-note"),
  sourcesOpen: document.querySelector("#sources-open"),
  sourcesClose: document.querySelector("#sources-close"),
  sourcesDialog: document.querySelector("#sources-dialog")
};

const mapState = {
  map: null,
  layer: null,
  referenceLayer: null,
  markers: new Map(),
  stations: new Map(),
  selectedStationId: null
};

const chartState = {
  soundDays: 7,
  waveDays: 7,
  forecastMode: "hourly",
  data: null,
  usingStoredSnapshot: false,
  refreshError: null
};

const SNAPSHOT_STORAGE_KEY = "obx-conditions:snapshot:v1";
const STALE_SNAPSHOT_MS = 30 * 60 * 1000;
const VISTA_WEBCAM_STREAM = "2O09J4QSEV";

const fmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short"
});

const oneDecimal = (value) => Number.isFinite(value) ? value.toFixed(1) : "--";
const zeroDecimal = (value) => Number.isFinite(value) ? Math.round(value).toString() : "--";
const milesPerHour = (value) => Number.isFinite(value) ? value * 2.23694 : undefined;
const hpaToInHg = (value) => Number.isFinite(value) ? value / 33.86389 : undefined;
const signed = (value, unit) => {
  if (!Number.isFinite(value)) return "--";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)} ${unit}`;
};

function setText(node, value) {
  if (node) node.textContent = value;
}

function openSourcesDialog() {
  if (!els.sourcesDialog) return;
  if (typeof els.sourcesDialog.showModal === "function") {
    els.sourcesDialog.showModal();
  } else {
    els.sourcesDialog.setAttribute("open", "");
  }
}

function closeSourcesDialog() {
  if (!els.sourcesDialog) return;
  if (typeof els.sourcesDialog.close === "function") {
    els.sourcesDialog.close();
  } else {
    els.sourcesDialog.removeAttribute("open");
  }
}

function initVistaWebcam(retries = 20) {
  const container = document.querySelector(`[data-vistawebcams-stream="${VISTA_WEBCAM_STREAM}"]`);
  if (!container || container.dataset.vistawebcamsInitialized === "true" || container._vistawebcamsPlayer) return;

  const Player = window.VistaWebcams?.Player;
  if (!Player) {
    if (retries > 0) window.setTimeout(() => initVistaWebcam(retries - 1), 250);
    return;
  }

  try {
    const player = new Player(container, {
      streamName: VISTA_WEBCAM_STREAM,
      autoplay: "muted",
      controls: true
    });
    container._vistawebcamsPlayer = player;
    player.init().catch((error) => {
      console.error("[OBX] Failed to initialize Vista webcam", error);
    });
  } catch (error) {
    console.error("[OBX] Failed to create Vista webcam player", error);
  }
}

function ageLabelFromMs(ageMs) {
  if (!Number.isFinite(ageMs) || ageMs < 0) return "unknown age";
  const totalSeconds = Math.floor(ageMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h ${minutes % 60}m old`;
  if (minutes > 0) return `${minutes}m ${seconds}s old`;
  return `${seconds}s old`;
}

function updateCacheStatus() {
  const data = chartState.data;
  if (!data?.generatedAt) return;

  const generatedAt = new Date(data.generatedAt);
  const ageMs = Date.now() - generatedAt.getTime();
  const isStale = ageMs >= STALE_SNAPSHOT_MS;
  const errors = data.errors || {};
  const hasErrors = Object.keys(errors).length > 0;
  const cacheLabel = chartState.usingStoredSnapshot || data.cache?.status === "cached" ? "cached" : "fresh";

  els.statusDot?.classList.toggle("ok", !isStale && !hasErrors && !chartState.refreshError);
  els.statusDot?.classList.toggle("stale", isStale);

  setText(els.status, isStale
    ? "Data stale"
    : chartState.refreshError
      ? "Showing cached data"
      : hasErrors
        ? "Partial live data"
        : "All live feeds loaded");
  setText(els.lastUpdated, `Updated ${fmt.format(generatedAt)} · ${cacheLabel} · ${ageLabelFromMs(ageMs)}`);
}

function readStoredSnapshot() {
  try {
    const snapshot = JSON.parse(localStorage.getItem(SNAPSHOT_STORAGE_KEY) || "null");
    return snapshot && snapshot.generatedAt ? snapshot : null;
  } catch {
    return null;
  }
}

function writeStoredSnapshot(snapshot) {
  try {
    localStorage.setItem(SNAPSHOT_STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // Storage can be unavailable in private browsing or constrained devices.
  }
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

function hourLabel(time) {
  const date = new Date(time);
  if (!Number.isFinite(date.getTime())) return "--";
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric"
  }).format(date);
}

function dayLabel(time, fallback = "--") {
  const date = new Date(time);
  if (!Number.isFinite(date.getTime())) return fallback;
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short"
  }).format(date);
}

function windDirectionDegrees(direction) {
  const normalized = String(direction || "").trim().toUpperCase();
  const directions = {
    N: 0,
    NNE: 22.5,
    NE: 45,
    ENE: 67.5,
    E: 90,
    ESE: 112.5,
    SE: 135,
    SSE: 157.5,
    S: 180,
    SSW: 202.5,
    SW: 225,
    WSW: 247.5,
    W: 270,
    WNW: 292.5,
    NW: 315,
    NNW: 337.5
  };
  return directions[normalized];
}

function milesBetween(a, b) {
  const earthRadiusMiles = 3958.8;
  const lat1 = Number(a?.lat);
  const lon1 = Number(a?.lon);
  const lat2 = Number(b?.lat);
  const lon2 = Number(b?.lon);
  if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return undefined;
  const toRad = (value) => value * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const rLat1 = toRad(lat1);
  const rLat2 = toRad(lat2);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rLat1) * Math.cos(rLat2) * Math.sin(dLon / 2) ** 2;
  return 2 * earthRadiusMiles * Math.asin(Math.sqrt(h));
}

function bearingDegrees(from, to) {
  const lat1 = Number(from?.lat);
  const lon1 = Number(from?.lon);
  const lat2 = Number(to?.lat);
  const lon2 = Number(to?.lon);
  if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return undefined;
  const toRad = (value) => value * Math.PI / 180;
  const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1));
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function cursorTimeLabel(time) {
  const date = new Date(time);
  if (!Number.isFinite(date.getTime())) return "--";
  return new Intl.DateTimeFormat("en-US", {
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function shortTickLabel(time) {
  const date = new Date(time);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    month: "numeric",
    day: "numeric"
  }).format(date);
}

function rangeLabel(days) {
  return `${days}d`;
}

function recentWindow(points, days) {
  if (!Array.isArray(points) || !points.length) return [];
  const latestMs = new Date(points.at(-1)?.time ?? "").getTime();
  if (!Number.isFinite(latestMs)) return points;
  const cutoff = latestMs - days * 24 * 60 * 60 * 1000;
  return points.filter((point) => new Date(point.time).getTime() >= cutoff);
}

function chartSeries(data, days) {
  return data?.seriesByDays?.[days] || data?.seriesByDays?.[String(days)] || recentWindow(data?.series, days);
}

function valueRange(points, key) {
  const values = (points || []).map((point) => point[key]).filter(Number.isFinite);
  return values.length ? { min: Math.min(...values), max: Math.max(...values) } : undefined;
}

function syncChartControls(group, selectedDays) {
  group?.querySelectorAll("button[data-days]").forEach((button) => {
    button.setAttribute("aria-pressed", String(Number(button.dataset.days) === selectedDays));
  });
}

function syncForecastControls() {
  els.forecastControls?.querySelectorAll("button[data-forecast-mode]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.forecastMode === chartState.forecastMode));
  });
}

function renderTopCharts() {
  const sound = chartState.data?.sound;
  const marine = chartState.data?.marine;

  if (sound?.latest) {
    const soundPoints = chartSeries(sound, chartState.soundDays);
    const soundRange = sound.rangeByDays?.[chartState.soundDays] ||
      sound.rangeByDays?.[String(chartState.soundDays)] ||
      valueRange(soundPoints, "value") ||
      sound.range;
    setText(els.soundRangeLabel, `${rangeLabel(chartState.soundDays)} range`);
    setText(els.soundRange, `${oneDecimal(soundRange?.min)}-${oneDecimal(soundRange?.max)} ft`);
    els.soundChart?.setAttribute("aria-label", `${rangeLabel(chartState.soundDays)} water level chart`);
    renderSparkline(els.soundChart, soundPoints, "value", "#0f5d6d", "rgba(15, 93, 109, 0.14)", "ft", {
      days: chartState.soundDays
    });
  }

  if (marine?.latest) {
    const wavePoints = chartSeries(marine, chartState.waveDays);
    els.waveChart?.setAttribute("aria-label", `${rangeLabel(chartState.waveDays)} wave height chart`);
    renderSparkline(els.waveChart, wavePoints, "waveHeightFt", "#bfe8df", "rgba(191, 232, 223, 0.18)", "ft", {
      days: chartState.waveDays
    });
  }

  syncChartControls(els.soundChartControls, chartState.soundDays);
  syncChartControls(els.waveChartControls, chartState.waveDays);
  renderWindPrediction(chartState.data?.weather);
}

function renderWindPrediction(weather) {
  if (!els.windPredictionList) return;

  const isHourly = chartState.soundDays === 1;
  const periods = Array.isArray(isHourly ? weather?.forecast : weather?.dailyForecast)
    ? (isHourly ? weather.forecast : weather.dailyForecast).slice(0, isHourly ? 8 : 7)
    : [];

  setText(els.windPredictionMode, isHourly ? "Hourly" : "Daily");

  if (!periods.length) {
    els.windPredictionList.innerHTML = `<p class="wind-prediction-empty">No ${isHourly ? "hourly" : "daily"} wind forecast is available right now.</p>`;
    return;
  }

  els.windPredictionList.innerHTML = periods.map((period) => {
    const degrees = windDirectionDegrees(period.windDirection);
    const arrowDegrees = Number.isFinite(degrees) ? (degrees + 180) % 360 : undefined;
    const label = isHourly ? hourLabel(period.time) : period.name || dayLabel(period.time);
    const speed = period.windSpeed || "--";
    const windLabel = period.windDirection ? `Wind from ${period.windDirection}` : "Wind direction unavailable";
    return `
      <div class="wind-prediction-item">
        <span class="wind-prediction-time">${escapeHtml(label)}</span>
        <span class="wind-prediction-arrow${Number.isFinite(arrowDegrees) ? "" : " neutral"}" style="${Number.isFinite(arrowDegrees) ? `--wind-rotation:${arrowDegrees}deg` : ""}" aria-label="${escapeHtml(windLabel)}" title="${escapeHtml(windLabel)}"></span>
        <span class="wind-prediction-direction">${escapeHtml(period.windDirection || "--")}</span>
        <strong>${escapeHtml(speed)}</strong>
      </div>
    `;
  }).join("");
}

function renderSparkline(svg, points, key, color = "#0f5d6d", fill = "rgba(15, 93, 109, 0.14)", unit = "", options = {}) {
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
  const isOneDay = options.days === 1;
  const xTickCount = isOneDay ? 5 : 7;
  const xTicks = Array.from({ length: xTickCount }, (_, index) => {
    const ratio = xTickCount === 1 ? 0 : index / (xTickCount - 1);
    const pointIndex = Math.min(points.length - 1, Math.round(ratio * (points.length - 1)));
    return {
      x: padLeft + ratio * usableW,
      label: isOneDay ? hourLabel(points[pointIndex]?.time) : shortTickLabel(points[pointIndex]?.time)
    };
  });
  const gridColor = color === "#bfe8df" ? "rgba(238, 251, 247, 0.24)" : "rgba(19, 36, 34, 0.16)";
  const labelColor = color === "#bfe8df" ? "rgba(238, 251, 247, 0.72)" : "rgba(19, 36, 34, 0.56)";
  const cursorLabelColor = color === "#bfe8df" ? "#eefbf7" : "#093944";
  const cursorBgColor = color === "#bfe8df" ? "rgba(9, 57, 68, 0.82)" : "rgba(255, 250, 240, 0.92)";

  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.classList.add("has-chart-cursor");
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
    <g class="chart-cursor" opacity="0">
      <line class="chart-cursor-line" x1="${padLeft}" x2="${padLeft}" y1="${padTop}" y2="${baselineY}" stroke="${color}"></line>
      <circle class="chart-cursor-dot" cx="${padLeft}" cy="${padTop}" r="6" fill="${color}"></circle>
      <rect class="chart-cursor-bg" x="${padLeft}" y="${padTop}" width="112" height="34" rx="8" fill="${cursorBgColor}"></rect>
      <text class="chart-cursor-value" x="${padLeft}" y="${padTop}" text-anchor="middle" fill="${cursorLabelColor}"></text>
      <text class="chart-cursor-time" x="${padLeft}" y="${padTop}" text-anchor="middle" fill="${cursorLabelColor}"></text>
    </g>
    <rect class="chart-hit-area" x="${padLeft}" y="${padTop}" width="${usableW}" height="${usableH}" fill="transparent"></rect>
  `;

  bindChartCursor(svg, points, coords, key, unit, {
    padLeft,
    padRight,
    padTop,
    width
  });
}

function bindChartCursor(svg, points, coords, key, unit, layout) {
  const cursor = svg.querySelector(".chart-cursor");
  const line = svg.querySelector(".chart-cursor-line");
  const dot = svg.querySelector(".chart-cursor-dot");
  const bg = svg.querySelector(".chart-cursor-bg");
  const valueText = svg.querySelector(".chart-cursor-value");
  const timeText = svg.querySelector(".chart-cursor-time");
  const hitArea = svg.querySelector(".chart-hit-area");
  if (!cursor || !line || !dot || !bg || !valueText || !timeText || !hitArea) return;

  const showPoint = (clientX) => {
    const rect = svg.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const x = ratio * layout.width;
    const pointRatio = Math.min(1, Math.max(0, (x - layout.padLeft) / (layout.width - layout.padLeft - layout.padRight)));
    const index = Math.min(points.length - 1, Math.max(0, Math.round(pointRatio * (points.length - 1))));
    const [cx, cy] = coords[index];
    const point = points[index];
    const labelX = Math.min(layout.width - 66, Math.max(layout.padLeft + 66, cx));
    const labelY = Math.max(layout.padTop + 38, cy - 18);

    cursor.setAttribute("opacity", "1");
    line.setAttribute("x1", cx.toFixed(2));
    line.setAttribute("x2", cx.toFixed(2));
    dot.setAttribute("cx", cx.toFixed(2));
    dot.setAttribute("cy", cy.toFixed(2));
    bg.setAttribute("x", (labelX - 56).toFixed(2));
    bg.setAttribute("y", (labelY - 28).toFixed(2));
    valueText.setAttribute("x", labelX.toFixed(2));
    valueText.setAttribute("y", (labelY - 14).toFixed(2));
    valueText.textContent = `${oneDecimal(point?.[key])}${unit}`;
    timeText.setAttribute("x", labelX.toFixed(2));
    timeText.setAttribute("y", (labelY + 1).toFixed(2));
    timeText.textContent = cursorTimeLabel(point?.time);
  };

  hitArea.addEventListener("pointermove", (event) => showPoint(event.clientX));
  hitArea.addEventListener("pointerenter", (event) => showPoint(event.clientX));
  hitArea.addEventListener("pointerleave", () => cursor.setAttribute("opacity", "0"));
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

function pointOffsetMiles(point, eastMiles = 0, northMiles = 0) {
  const lat = Number(point?.lat);
  const lon = Number(point?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return undefined;
  const milesPerDegreeLat = 69;
  const milesPerDegreeLon = Math.max(1, 69 * Math.cos(lat * Math.PI / 180));
  return [lat + northMiles / milesPerDegreeLat, lon + eastMiles / milesPerDegreeLon];
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
    [
      { label: "1 mi", radius: 1609.344, color: "#d9672b", eastMiles: 1 },
      { label: "10 mi", radius: 16093.44, color: "#b73f25", eastMiles: 10 }
    ].forEach((ring) => {
      window.L.circle([reference.lat, reference.lon], {
        radius: ring.radius,
        color: ring.color,
        weight: ring.label === "1 mi" ? 2 : 2.5,
        opacity: ring.label === "1 mi" ? 0.8 : 0.72,
        fillColor: ring.color,
        fillOpacity: ring.label === "1 mi" ? 0.08 : 0.035
      }).addTo(mapState.referenceLayer);

      const labelPoint = pointOffsetMiles(reference, ring.eastMiles, ring.label === "1 mi" ? 0.18 : 0.45);
      if (!labelPoint) return;
      const ringIcon = window.L.divIcon({
        className: "leaflet-div-icon",
        html: `<div class="ring-label">${escapeHtml(ring.label)}</div>`,
        iconSize: [54, 26],
        iconAnchor: [27, 13]
      });
      window.L.marker(labelPoint, { icon: ringIcon, interactive: false }).addTo(mapState.referenceLayer);
    });
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
    map.fitBounds(bounds, { padding: [34, 34], maxZoom: 8 });
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
    if (els.tideChart) els.tideChart.innerHTML = "";
    if (els.tideList) els.tideList.innerHTML = "";
    return;
  }

  setText(els.tideHeight, oneDecimal(tide.next.valueFt));
  setText(els.tideType, `${tide.next.type} tide`);
  setText(els.tideCountdown, `in ${timeUntilLabel(tide.next.time)}`);
  setText(els.tideNextTime, fmt.format(new Date(tide.next.time)));
  setText(els.tideStation, tide.station?.name || "--");
  setText(els.tideDatum, tide.station?.datum || "--");
  setText(els.tideNote, `${tide.station?.name || "Sandbridge"} is the closest NOAA tide-prediction station found for the VA/NC line, about ${oneDecimal(tide.distanceFromReferenceMiles)} mi north and ${oneDecimal(tide.distanceFromCarovaMiles)} mi from Carova Beach.`);
  renderTideChart(els.tideChart, tide);

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

function renderTideChart(svg, tide) {
  const predictions = [
    ...(tide?.predictions || []),
    ...(tide?.previous ? [tide.previous] : []),
    ...(tide?.upcoming || [])
  ]
    .filter((point) => Number.isFinite(point.valueFt) && Number.isFinite(new Date(point.time).getTime()))
    .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
  const uniquePredictions = [];
  const seenPredictionKeys = new Set();
  for (const point of predictions) {
    const key = `${point.time}-${point.type}`;
    if (seenPredictionKeys.has(key)) continue;
    seenPredictionKeys.add(key);
    uniquePredictions.push(point);
  }

  if (!svg || uniquePredictions.length < 2) {
    if (svg) svg.innerHTML = "";
    return;
  }

  const now = Date.now();
  const nextIndex = uniquePredictions.findIndex((point) => new Date(point.time).getTime() > now);
  const startIndex = nextIndex === -1 ? Math.max(0, uniquePredictions.length - 5) : Math.max(0, nextIndex - 1);
  const visible = uniquePredictions.slice(startIndex, startIndex + 5);
  if (visible.length < 2) {
    svg.innerHTML = "";
    return;
  }

  const width = 520;
  const height = 150;
  const padX = 34;
  const padTop = 18;
  const padBottom = 30;
  const usableW = width - padX * 2;
  const usableH = height - padTop - padBottom;
  const values = visible.map((point) => point.valueFt);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = max - min || 1;
  const startMs = new Date(visible[0].time).getTime();
  const endMs = new Date(visible.at(-1).time).getTime();
  const timeSpread = endMs - startMs || 1;
  const xForTime = (time) => padX + ((new Date(time).getTime() - startMs) / timeSpread) * usableW;
  const yForValue = (value) => padTop + (1 - (value - min) / spread) * usableH;
  const samples = [];
  const cursorPoints = [];

  for (let index = 0; index < visible.length - 1; index++) {
    const current = visible[index];
    const next = visible[index + 1];
    const currentMs = new Date(current.time).getTime();
    const nextMs = new Date(next.time).getTime();
    for (let step = 0; step <= 18; step++) {
      if (index > 0 && step === 0) continue;
      const ratio = step / 18;
      const eased = (1 - Math.cos(Math.PI * ratio)) / 2;
      const time = currentMs + (nextMs - currentMs) * ratio;
      const value = current.valueFt + (next.valueFt - current.valueFt) * eased;
      samples.push([padX + ((time - startMs) / timeSpread) * usableW, yForValue(value)]);
      cursorPoints.push({
        time: new Date(time).toISOString(),
        valueFt: value
      });
    }
  }

  const line = samples.map(([x, y], index) => `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`).join(" ");
  const baselineY = height - padBottom;
  const area = `${line} L ${samples.at(-1)[0].toFixed(2)} ${baselineY} L ${samples[0][0].toFixed(2)} ${baselineY} Z`;
  const nowX = now >= startMs && now <= endMs ? padX + ((now - startMs) / timeSpread) * usableW : undefined;

  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.classList.add("has-chart-cursor");
  svg.innerHTML = `
    <path d="${area}" fill="rgba(15, 93, 109, 0.14)"></path>
    <path d="${line}" fill="none" stroke="#0f5d6d" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"></path>
    ${visible.map((point) => {
      const x = xForTime(point.time);
      const y = yForValue(point.valueFt);
      const isHigh = point.type === "High";
      const labelY = isHigh ? Math.max(13, y - 12) : Math.min(height - 10, y + 22);
      return `
        <line class="tide-chart-marker" x1="${x.toFixed(2)}" x2="${x.toFixed(2)}" y1="${padTop}" y2="${baselineY}"></line>
        <circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="6" class="tide-chart-dot ${isHigh ? "high" : "low"}"></circle>
        <text class="tide-chart-label" x="${x.toFixed(2)}" y="${labelY.toFixed(2)}" text-anchor="middle">${isHigh ? "High" : "Low"} ${oneDecimal(point.valueFt)} ft</text>
        <text class="tide-chart-time" x="${x.toFixed(2)}" y="${height - 8}" text-anchor="middle">${escapeHtml(hourLabel(point.time))}</text>
      `;
    }).join("")}
    ${Number.isFinite(nowX) ? `
      <line class="tide-chart-now" x1="${nowX.toFixed(2)}" x2="${nowX.toFixed(2)}" y1="${padTop}" y2="${baselineY}"></line>
      <text class="tide-chart-now-label" x="${nowX.toFixed(2)}" y="${padTop + 10}" text-anchor="middle">Now</text>
    ` : ""}
    <g class="chart-cursor" opacity="0">
      <line class="chart-cursor-line" x1="${padX}" x2="${padX}" y1="${padTop}" y2="${baselineY}" stroke="#0f5d6d"></line>
      <circle class="chart-cursor-dot" cx="${padX}" cy="${padTop}" r="6" fill="#0f5d6d"></circle>
      <rect class="chart-cursor-bg" x="${padX}" y="${padTop}" width="112" height="34" rx="8" fill="rgba(255, 250, 240, 0.92)"></rect>
      <text class="chart-cursor-value" x="${padX}" y="${padTop}" text-anchor="middle" fill="#093944"></text>
      <text class="chart-cursor-time" x="${padX}" y="${padTop}" text-anchor="middle" fill="#093944"></text>
    </g>
    <rect class="chart-hit-area" x="${padX}" y="${padTop}" width="${usableW}" height="${usableH}" fill="transparent"></rect>
  `;

  bindChartCursor(svg, cursorPoints, samples, "valueFt", " ft", {
    padLeft: padX,
    padRight: padX,
    padTop,
    width
  });
}

function renderForecast(weather) {
  if (!els.forecastList) return;
  const isDaily = chartState.forecastMode === "daily";
  const periods = Array.isArray(isDaily ? weather?.dailyForecast : weather?.forecast)
    ? (isDaily ? weather.dailyForecast : weather.forecast).slice(0, 5)
    : [];
  setText(els.forecastTitle, isDaily ? "Next few days" : "Next few hours");
  syncForecastControls();

  if (!periods.length) {
    els.forecastList.innerHTML = `<p class="forecast-empty">No ${isDaily ? "daily" : "hourly"} forecast is available right now.</p>`;
    return;
  }

  els.forecastList.innerHTML = periods.map((period) => {
    const label = isDaily ? period.name || dayLabel(period.time) : hourLabel(period.time);
    return `
    <div class="forecast-item${isDaily ? " daily" : ""}">
      <strong>${escapeHtml(label)}</strong>
      <span>${escapeHtml(zeroDecimal(period.temperatureF))}°</span>
      <span>${escapeHtml(period.shortForecast || "--")}</span>
      <small>${Number.isFinite(period.precipChance) ? `${zeroDecimal(period.precipChance)}% rain` : "--"} · ${escapeHtml(`${period.windDirection || ""} ${period.windSpeed || ""}`.trim() || "--")}</small>
    </div>
  `;
  }).join("");
}

function render(data) {
  const { sound, marine, weather, buoys, tide, errors } = data;
  chartState.data = data;

  updateCacheStatus();
  renderAlerts(errors);

  if (sound?.latest) {
    setText(els.soundLevel, oneDecimal(sound.latest.value));
    setText(els.sound24h, signed(sound.change24h, "ft"));
    setText(els.soundTime, fmt.format(new Date(sound.latest.time)));
    setText(els.soundTrend, Number.isFinite(sound.change24h) ? (sound.change24h >= 0 ? "Rising" : "Falling") : "--");
    els.soundTrend.classList.toggle("down", sound.change24h < 0);
  }

  if (marine?.latest) {
    setText(els.waveHeight, oneDecimal(marine.latest.waveHeightFt));
    setText(els.waterTemp, oneDecimal(marine.latest.waterTempF));
    setText(els.wavePeriod, `${zeroDecimal(marine.latest.dominantPeriodSec)} sec dominant period`);
    setText(els.waveDirection, `${marine.latest.meanWaveDirectionText || "--"} mean direction`);
    setText(els.marineAir, `${oneDecimal(marine.latest.airTempF)} °F`);
    setText(els.swell, marine.spectral ? `${oneDecimal(marine.spectral.swellHeightFt)} ft @ ${oneDecimal(marine.spectral.swellPeriodSec)} sec ${marine.spectral.swellDirection || ""}` : "--");
    setText(els.windWave, marine.spectral ? `${oneDecimal(marine.spectral.windWaveHeightFt)} ft @ ${oneDecimal(marine.spectral.windWavePeriodSec)} sec ${marine.spectral.windWaveDirection || ""}` : "--");
    const marineWindMph = milesPerHour(marine.latest.windSpeedMps);
    setText(els.marineWind, Number.isFinite(marineWindMph)
      ? `${zeroDecimal(marineWindMph)} mph${Number.isFinite(marine.latest.windGustMps) ? ` gust ${zeroDecimal(milesPerHour(marine.latest.windGustMps))}` : ""}`
      : "--");
    setText(els.marinePressure, Number.isFinite(marine.latest.pressureHpa) ? `${hpaToInHg(marine.latest.pressureHpa).toFixed(2)} in` : "--");
    setText(els.marineDew, Number.isFinite(marine.latest.dewPointF) ? `${oneDecimal(marine.latest.dewPointF)} °F` : "--");
  }

  renderTopCharts();

  if (weather) {
    setText(els.weatherTemp, zeroDecimal(weather.temperatureF));
    setText(els.weatherSummary, weather.summary || "--");
    setText(els.weatherWind, weather.wind || "--");
    setText(els.weatherHumidity, Number.isFinite(weather.humidity) ? `${zeroDecimal(weather.humidity)}%` : "--");
    setText(els.weatherPressure, Number.isFinite(weather.pressureInHg) ? `${weather.pressureInHg.toFixed(2)} in` : "--");
    setText(els.weatherRain, Number.isFinite(weather.precipChance) ? `${zeroDecimal(weather.precipChance)}%` : "--");
    setText(els.weatherNote, weather.note || "");
    renderForecast(weather);
  }

  renderTide(tide);
  renderBuoyMap(buoys);
}

function bindChartControls(group, stateKey) {
  group?.querySelectorAll("button[data-days]").forEach((button) => {
    button.addEventListener("click", () => {
      chartState[stateKey] = Number(button.dataset.days);
      renderTopCharts();
    });
  });
}

bindChartControls(els.soundChartControls, "soundDays");
bindChartControls(els.waveChartControls, "waveDays");

els.forecastControls?.querySelectorAll("button[data-forecast-mode]").forEach((button) => {
  button.addEventListener("click", () => {
    chartState.forecastMode = button.dataset.forecastMode === "daily" ? "daily" : "hourly";
    renderForecast(chartState.data?.weather);
  });
});

els.sourcesOpen?.addEventListener("click", openSourcesDialog);
els.sourcesClose?.addEventListener("click", closeSourcesDialog);
els.sourcesDialog?.addEventListener("click", (event) => {
  if (event.target === els.sourcesDialog) closeSourcesDialog();
});

async function load() {
  const storedSnapshot = readStoredSnapshot();
  if (storedSnapshot && !chartState.data) {
    chartState.usingStoredSnapshot = true;
    chartState.refreshError = null;
    render(storedSnapshot);
  }

  try {
    const response = await fetch("/api/snapshot", { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`Dashboard API returned ${response.status}`);
    const snapshot = await response.json();
    writeStoredSnapshot(snapshot);
    chartState.usingStoredSnapshot = false;
    chartState.refreshError = null;
    render(snapshot);
  } catch (error) {
    if (!storedSnapshot) {
      chartState.refreshError = error.message;
      setText(els.status, "Unable to load data");
      setText(els.lastUpdated, error.message);
      els.statusDot.classList.remove("ok");
      els.statusDot.classList.remove("stale");
      renderAlerts({ dashboard: error.message });
    } else {
      chartState.usingStoredSnapshot = true;
      chartState.refreshError = error.message;
      updateCacheStatus();
      renderAlerts({ dashboard: `Refresh failed: ${error.message}` });
    }
  }
}

load();
initVistaWebcam();
setInterval(updateCacheStatus, 1000);
