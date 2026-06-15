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
  surfChartMode: document.querySelector("#surf-chart-mode"),
  waveChartControls: document.querySelector("#wave-chart-controls"),
  swell: document.querySelector("#swell"),
  windWave: document.querySelector("#wind-wave"),
  marineAir: document.querySelector("#marine-air"),
  surfTempTrend: document.querySelector("#surf-temp-trend"),
  surfTempRangeLabel: document.querySelector("#surf-temp-range-label"),
  surfTempRange: document.querySelector("#surf-temp-range"),
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
  buoyWarmest: document.querySelector("#buoy-warmest"),
  buoyRise: document.querySelector("#buoy-rise"),
  buoyDrop: document.querySelector("#buoy-drop"),
  buoyDetail: document.querySelector("#buoy-detail"),
  buoyNote: document.querySelector("#buoy-note"),
  themeToggle: document.querySelector("#theme-toggle"),
  themeStatus: document.querySelector("#theme-status"),
  sourcesOpen: document.querySelector("#sources-open"),
  sourcesClose: document.querySelector("#sources-close"),
  sourcesDialog: document.querySelector("#sources-dialog")
};

const mapState = {
  map: null,
  layer: null,
  referenceLayer: null,
  baseLayer: null,
  markers: new Map(),
  stations: new Map(),
  trends: new Map(),
  selectedStationId: null,
  hoveredStationId: null,
  bounds: null,
  resizeTimer: null
};

const chartState = {
  soundDays: 7,
  waveDays: 7,
  surfSeries: "water",
  forecastMode: "hourly",
  data: null,
  usingStoredSnapshot: false,
  refreshError: null
};

const THEME_STORAGE_KEY = "obx-conditions:theme:v1";
const THEME_QUERY = "(prefers-color-scheme: dark)";

const MAP_TILE_THEMES = {
  light: {
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    options: {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }
  },
  dark: {
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    options: {
      maxZoom: 18,
      subdomains: ["a", "b", "c", "d"],
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
    }
  }
};

const SNAPSHOT_STORAGE_KEY = "obx-conditions:snapshot:v1";
const STALE_SNAPSHOT_MS = 30 * 60 * 1000;
const themeMediaQuery = window.matchMedia(THEME_QUERY);
let themePreference = "system";

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
const dewPointFromHumidityF = (temperatureF, humidity) => {
  if (!Number.isFinite(temperatureF) || !Number.isFinite(humidity) || humidity <= 0) return undefined;
  const temperatureC = (temperatureF - 32) * 5 / 9;
  const alpha = Math.log(humidity / 100) + (17.625 * temperatureC) / (243.04 + temperatureC);
  return ((243.04 * alpha) / (17.625 - alpha)) * 9 / 5 + 32;
};
const signed = (value, unit) => {
  if (!Number.isFinite(value)) return "--";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)} ${unit}`;
};
const signedOneDecimal = (value, unit) => {
  if (!Number.isFinite(value)) return "--";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)} ${unit}`;
};

function readThemePreference() {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    return "system";
  }
}

function persistThemePreference(nextPreference) {
  try {
    if (nextPreference === "system") {
      localStorage.removeItem(THEME_STORAGE_KEY);
    } else {
      localStorage.setItem(THEME_STORAGE_KEY, nextPreference);
    }
  } catch {
    // Ignore localStorage write failures.
  }
}

function getSystemTheme() {
  return themeMediaQuery.matches ? "dark" : "light";
}

function getResolvedTheme(preference = themePreference) {
  return preference === "system" ? getSystemTheme() : preference;
}

function getThemePalette(theme = getResolvedTheme()) {
  const isDark = theme === "dark";
  if (!isDark) {
    return {
      sound: {
        line: "#0f5d6d",
        fill: "rgba(15, 93, 109, 0.14)",
        grid: "rgba(19, 36, 34, 0.16)",
        label: "rgba(19, 36, 34, 0.56)",
        cursorBg: "rgba(255, 250, 240, 0.92)",
        cursorText: "#093944",
        markerText: "#093944"
      },
      wave: {
        line: "#bfe8df",
        fill: "rgba(191, 232, 223, 0.18)",
        grid: "rgba(238, 251, 247, 0.24)",
        label: "rgba(238, 251, 247, 0.72)",
        cursorBg: "rgba(9, 57, 68, 0.82)",
        cursorText: "#eefbf7",
        markerText: "#eefbf7"
      },
      water: {
        line: "#f4b18a",
        fill: "rgba(244, 177, 138, 0.2)",
        grid: "rgba(238, 251, 247, 0.24)",
        label: "rgba(238, 251, 247, 0.72)",
        cursorBg: "rgba(9, 57, 68, 0.82)",
        cursorText: "#eefbf7",
        markerText: "#eefbf7"
      },
      tide: {
        fill: "rgba(15, 93, 109, 0.14)",
        line: "#0f5d6d",
        cursorLine: "#0f5d6d",
        cursorBg: "rgba(255, 250, 240, 0.92)",
        cursorText: "#093944",
        nowLabel: "#89401e",
        nowLine: "#d9672b"
      }
    };
  }

  return {
    sound: {
      line: "#8ac7d6",
      fill: "rgba(138, 199, 214, 0.2)",
      grid: "rgba(238, 251, 247, 0.22)",
      label: "rgba(238, 251, 247, 0.8)",
      cursorBg: "rgba(9, 57, 68, 0.86)",
      cursorText: "#f4f8f9",
      markerText: "#f4f8f9"
    },
    wave: {
      line: "#b8e8f5",
      fill: "rgba(173, 224, 236, 0.2)",
      grid: "rgba(238, 251, 247, 0.24)",
      label: "rgba(238, 251, 247, 0.8)",
      cursorBg: "rgba(9, 57, 68, 0.86)",
      cursorText: "#f4f8f9",
      markerText: "#f4f8f9"
    },
    water: {
      line: "#f6c09f",
      fill: "rgba(246, 192, 159, 0.2)",
      grid: "rgba(238, 251, 247, 0.24)",
      label: "rgba(238, 251, 247, 0.8)",
      cursorBg: "rgba(9, 57, 68, 0.86)",
      cursorText: "#f4f8f9",
      markerText: "#f4f8f9"
    },
    tide: {
      fill: "rgba(16, 64, 82, 0.35)",
      line: "#8ac7d6",
      cursorLine: "#8ac7d6",
      cursorBg: "rgba(9, 57, 68, 0.86)",
      cursorText: "#f4f8f9",
      nowLabel: "#f4b18a",
      nowLine: "#f5af86"
    }
  };
}

function getBuoyTileConfig(theme = getResolvedTheme()) {
  return MAP_TILE_THEMES[theme] ?? MAP_TILE_THEMES.light;
}

function createBuoyTileLayer(theme = getResolvedTheme()) {
  if (!window.L) return null;
  const config = getBuoyTileConfig(theme);
  return window.L.tileLayer(config.url, config.options);
}

function applyBuoyTileTheme(theme = getResolvedTheme()) {
  if (!mapState.map || !window.L || !mapState.baseLayer) return;
  if (mapState.baseLayer instanceof Object && mapState.baseLayer._obxTheme === theme) return;
  const nextLayer = createBuoyTileLayer(theme);
  if (!nextLayer) return;
  mapState.baseLayer.remove();
  nextLayer._obxTheme = theme;
  mapState.baseLayer = nextLayer.addTo(mapState.map);
}

function setThemePreference(nextPreference, { persist = false, rerender = true } = {}) {
  themePreference = nextPreference;
  if (persist) persistThemePreference(nextPreference);
  const resolvedTheme = getResolvedTheme();

  document.body.dataset.theme = resolvedTheme;
  const isDark = resolvedTheme === "dark";
  const statusLabel = themePreference === "system"
    ? `Following system (${resolvedTheme})`
    : `Manual (${resolvedTheme})`;

  if (els.themeToggle) {
    els.themeToggle.setAttribute("aria-pressed", String(isDark));
    els.themeToggle.setAttribute("aria-label", isDark ? "Enable light mode" : "Enable dark mode");
  }

  if (els.themeStatus) setText(els.themeStatus, statusLabel);

  applyBuoyTileTheme(resolvedTheme);

  if (rerender && chartState.data) {
    renderTopCharts();
    renderTide(chartState.data.tide);
  }
}

function toggleTheme() {
  const nextPreference = getResolvedTheme() === "dark" ? "light" : "dark";
  setThemePreference(nextPreference, { persist: true });
}

function onSystemThemeChange() {
  if (themePreference === "system") {
    setThemePreference("system");
  }
}

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

async function fetchBuoyTrends() {
  try {
    const response = await fetch("/api/buoy-trends", { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`Buoy trends returned ${response.status}`);
    return await response.json();
  } catch {
    return undefined;
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

function trendBadgeLabel(value) {
  if (!Number.isFinite(value)) return "--";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}°`;
}

function movementLabel(value) {
  if (!Number.isFinite(value)) return "--";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)} °F`;
}

function trendClass(value) {
  if (!Number.isFinite(value)) return "unknown";
  if (value > 0.2) return "rise";
  if (value < -0.2) return "drop";
  return "flat";
}

function zoneLabel(zone) {
  return String(zone || "")
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || "Station";
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

function valueChangeHours(points, key, hours = 24) {
  const valid = (points || [])
    .filter((point) => Number.isFinite(point[key]) && Number.isFinite(new Date(point.time).getTime()))
    .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
  const latest = valid.at(-1);
  if (!latest) return undefined;

  const targetMs = new Date(latest.time).getTime() - hours * 60 * 60 * 1000;
  const previous = [...valid].reverse().find((point) => new Date(point.time).getTime() <= targetMs);
  return previous ? latest[key] - previous[key] : undefined;
}

function syncChartControls(group, selectedDays) {
  group?.querySelectorAll("button[data-days]").forEach((button) => {
    button.setAttribute("aria-pressed", String(Number(button.dataset.days) === selectedDays));
  });
}

function syncSurfSeriesControls() {
  els.surfChartMode?.querySelectorAll("button[data-surf-series]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.surfSeries === chartState.surfSeries));
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
  const palette = getThemePalette();

  if (sound?.latest) {
    const soundPoints = chartSeries(sound, chartState.soundDays);
    const soundRange = sound.rangeByDays?.[chartState.soundDays] ||
      sound.rangeByDays?.[String(chartState.soundDays)] ||
      valueRange(soundPoints, "value") ||
      sound.range;
    setText(els.soundRangeLabel, `${rangeLabel(chartState.soundDays)} range`);
    setText(els.soundRange, `${oneDecimal(soundRange?.min)}-${oneDecimal(soundRange?.max)} ft`);
    els.soundChart?.setAttribute("aria-label", `${rangeLabel(chartState.soundDays)} water level chart`);
    renderSparkline(els.soundChart, soundPoints, "value", "ft", {
      days: chartState.soundDays,
      ...palette.sound
    });
  }

  if (marine?.latest) {
    const surfPoints = chartSeries(marine, chartState.waveDays);
    const waterRange = marine.waterTempRangeByDays?.[chartState.waveDays] ||
      marine.waterTempRangeByDays?.[String(chartState.waveDays)] ||
      valueRange(surfPoints, "waterTempF");
    const waterChange24h = Number.isFinite(marine.waterTempChange24h)
      ? marine.waterTempChange24h
      : valueChangeHours(chartSeries(marine, 7), "waterTempF", 24);
    setText(els.surfTempRangeLabel, `${rangeLabel(chartState.waveDays)} water range`);
    setText(els.surfTempTrend, signedOneDecimal(waterChange24h, "°F"));
    setText(els.surfTempRange, waterRange
      ? `${oneDecimal(waterRange.min)}-${oneDecimal(waterRange.max)} °F`
      : "--");

    const isWater = chartState.surfSeries === "water";
    const chartKey = isWater ? "waterTempF" : "waveHeightFt";
    const chartUnit = isWater ? "°F" : "ft";
    const chartLabel = isWater ? "water temperature" : "wave height";
    els.waveChart?.setAttribute("aria-label", `${rangeLabel(chartState.waveDays)} ${chartLabel} chart`);
    renderSparkline(els.waveChart, surfPoints, chartKey, chartUnit, {
      days: chartState.waveDays,
      emptyLabel: `No ${chartLabel} history`,
      ...(isWater ? palette.water : palette.wave)
    });
  }

  syncChartControls(els.soundChartControls, chartState.soundDays);
  syncChartControls(els.waveChartControls, chartState.waveDays);
  syncSurfSeriesControls();
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

function renderSparkline(svg, points, key, unit = "", options = {}) {
  if (!svg) return;

  const palette = {
    lineColor: options.lineColor ?? options.line ?? "#0f5d6d",
    fillColor: options.fillColor ?? options.fill ?? "rgba(15, 93, 109, 0.14)",
    gridColor: options.gridColor ?? options.grid ?? "rgba(19, 36, 34, 0.16)",
    labelColor: options.labelColor ?? options.label ?? "rgba(19, 36, 34, 0.56)",
    cursorLabelColor: options.cursorLabelColor ?? options.cursorText ?? "#093944",
    cursorBgColor: options.cursorBgColor ?? options.cursorBg ?? "rgba(255, 250, 240, 0.92)"
  };
  const chartPoints = Array.isArray(points)
    ? points.filter((point) => Number.isFinite(point[key]) && Number.isFinite(new Date(point.time).getTime()))
    : [];

  if (chartPoints.length < 2) {
    svg.classList.remove("has-chart-cursor");
    svg.setAttribute("viewBox", "0 0 640 180");
    svg.innerHTML = options.emptyLabel
      ? `<text class="chart-empty-label" x="320" y="94" text-anchor="middle" fill="${palette.labelColor}">${escapeHtml(options.emptyLabel)}</text>`
      : "";
    return;
  }

  const values = chartPoints.map((point) => point[key]).filter(Number.isFinite);
  if (!values.length) {
    svg.classList.remove("has-chart-cursor");
    svg.innerHTML = "";
    return;
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = max - min || 1;
  const compactChart = chartRenderedWidth(svg) < 430;
  const height = 180;
  const width = Math.round(height * chartRenderedAspect(svg, 640 / height));
  const padTop = 18;
  const padRight = 18;
  const padBottom = 30;
  const padLeft = compactChart ? 48 : 54;
  const usableW = width - padLeft - padRight;
  const usableH = height - padTop - padBottom;

  const coords = chartPoints.map((point, index) => {
    const value = point[key];
    const x = padLeft + (index / (chartPoints.length - 1)) * usableW;
    const y = padTop + (1 - (value - min) / spread) * usableH;
    return [x, y];
  });

  const line = coords.map(([x, y], index) => `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`).join(" ");
  const baselineY = height - padBottom;
  const area = `${line} L ${coords.at(-1)[0].toFixed(2)} ${baselineY} L ${coords[0][0].toFixed(2)} ${baselineY} Z`;
  const yTicks = [max, min + spread / 2, min];
  const isOneDay = options.days === 1;
  const xTickCount = compactChart ? 4 : isOneDay ? 5 : 7;
  const xTicks = Array.from({ length: xTickCount }, (_, index) => {
    const ratio = xTickCount === 1 ? 0 : index / (xTickCount - 1);
    const pointIndex = Math.min(chartPoints.length - 1, Math.round(ratio * (chartPoints.length - 1)));
    return {
      x: padLeft + ratio * usableW,
      label: isOneDay ? hourLabel(chartPoints[pointIndex]?.time) : shortTickLabel(chartPoints[pointIndex]?.time)
    };
  });

  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.classList.add("has-chart-cursor");
  svg.innerHTML = `
    ${yTicks.map((value) => {
      const y = padTop + (1 - (value - min) / spread) * usableH;
      return `
        <line class="chart-grid-line" x1="${padLeft}" x2="${width - padRight}" y1="${y.toFixed(2)}" y2="${y.toFixed(2)}" stroke="${palette.gridColor}"></line>
        <text class="chart-label" x="${padLeft - 10}" y="${(y + 4).toFixed(2)}" text-anchor="end" fill="${palette.labelColor}">${oneDecimal(value)}${unit}</text>
      `;
    }).join("")}
    ${xTicks.map((tick, index) => `
      <line class="chart-grid-line vertical" x1="${tick.x.toFixed(2)}" x2="${tick.x.toFixed(2)}" y1="${padTop}" y2="${baselineY}" stroke="${palette.gridColor}"></line>
      <text class="chart-label chart-x-label" x="${tick.x.toFixed(2)}" y="${height - 9}" text-anchor="${index === 0 ? "start" : index === xTicks.length - 1 ? "end" : "middle"}" fill="${palette.labelColor}">${escapeHtml(tick.label)}</text>
    `).join("")}
    <path d="${area}" fill="${palette.fillColor}"></path>
    <path d="${line}" fill="none" stroke="${palette.lineColor}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"></path>
    <circle cx="${coords.at(-1)[0].toFixed(2)}" cy="${coords.at(-1)[1].toFixed(2)}" r="7" fill="${palette.lineColor}"></circle>
    <g class="chart-cursor" opacity="0">
      <line class="chart-cursor-line" x1="${padLeft}" x2="${padLeft}" y1="${padTop}" y2="${baselineY}" stroke="${palette.lineColor}"></line>
      <circle class="chart-cursor-dot" cx="${padLeft}" cy="${padTop}" r="6" fill="${palette.lineColor}"></circle>
      <rect class="chart-cursor-bg" x="${padLeft}" y="${padTop}" width="112" height="34" rx="8" fill="${palette.cursorBgColor}"></rect>
      <text class="chart-cursor-value" x="${padLeft}" y="${padTop}" text-anchor="middle" fill="${palette.cursorLabelColor}"></text>
      <text class="chart-cursor-time" x="${padLeft}" y="${padTop}" text-anchor="middle" fill="${palette.cursorLabelColor}"></text>
    </g>
    <rect class="chart-hit-area" x="${padLeft}" y="${padTop}" width="${usableW}" height="${usableH}" fill="transparent"></rect>
  `;

  bindChartCursor(svg, chartPoints, coords, key, unit, {
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
    const rect = hitArea.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const plotWidth = layout.width - layout.padLeft - layout.padRight;
    const x = layout.padLeft + ratio * plotWidth;
    const index = coords.reduce((nearestIndex, coord, coordIndex) => {
      const nearestDistance = Math.abs(coords[nearestIndex][0] - x);
      const coordDistance = Math.abs(coord[0] - x);
      return coordDistance < nearestDistance ? coordIndex : nearestIndex;
    }, 0);
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
  const selectedTheme = getResolvedTheme();

  mapState.map = window.L.map(els.buoyMap, {
    scrollWheelZoom: false,
    zoomControl: true,
    zoomSnap: 0.25,
    zoomDelta: 0.25
  }).setView([reference?.lat ?? 36.55, reference?.lon ?? -75.87], 8);

  const tileLayer = createBuoyTileLayer(selectedTheme);
  if (tileLayer) {
    tileLayer._obxTheme = selectedTheme;
    mapState.baseLayer = tileLayer.addTo(mapState.map);
  }

  mapState.layer = window.L.layerGroup().addTo(mapState.map);
  mapState.referenceLayer = window.L.layerGroup().addTo(mapState.map);
  return mapState.map;
}

function fitBuoyMapBounds() {
  if (!mapState.map || !mapState.bounds?.length) return;
  const compactMap = els.buoyMap?.clientWidth < 520;
  const bounds = window.L.latLngBounds(mapState.bounds).pad(compactMap ? 0.26 : 0.1);
  mapState.map.invalidateSize();
  mapState.map.fitBounds(bounds, {
    animate: false,
    padding: compactMap ? [80, 72] : [84, 84],
    maxZoom: compactMap ? 6.35 : 7.65
  });
}

function scheduleBuoyMapResize() {
  if (!mapState.map) return;
  window.clearTimeout(mapState.resizeTimer);
  mapState.resizeTimer = window.setTimeout(fitBuoyMapBounds, 120);
}

function pointOffsetMiles(point, eastMiles = 0, northMiles = 0) {
  const lat = Number(point?.lat);
  const lon = Number(point?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return undefined;
  const milesPerDegreeLat = 69;
  const milesPerDegreeLon = Math.max(1, 69 * Math.cos(lat * Math.PI / 180));
  return [lat + northMiles / milesPerDegreeLat, lon + eastMiles / milesPerDegreeLon];
}

function stationWaterTemp(station) {
  return Number.isFinite(station.latest?.waterTempF)
    ? station.latest.waterTempF
    : station.trend?.latestWaterTempF;
}

function stationAgeHours(station) {
  return Number.isFinite(station.latestAgeHours)
    ? station.latestAgeHours
    : station.trend?.latestAgeHours;
}

function stationChange24h(station) {
  return station.trend?.change24hF;
}

function stationDistanceLabel(station) {
  return Number.isFinite(station.distanceFromVaNcLineMiles)
    ? `${oneDecimal(station.distanceFromVaNcLineMiles)} mi from VA/NC line`
    : "distance unknown";
}

function freshnessLabel(station) {
  const age = ageLabel(stationAgeHours(station));
  if (station.isStale) return `Stale · ${age}`;
  return age === "fresh" ? "Fresh" : `Fresh · ${age}`;
}

function mergeBuoyTrends(stations, trends) {
  const trendById = new Map((trends?.stations || []).map((trend) => [trend.stationId, trend]));
  return stations.map((station) => ({
    ...station,
    trend: trendById.get(station.id)
  }));
}

function sortBuoyStations(stations) {
  return [...stations].sort((a, b) => {
    const staleDelta = Number(Boolean(a.isStale)) - Number(Boolean(b.isStale));
    if (staleDelta) return staleDelta;
    const aMove = Number.isFinite(stationChange24h(a)) ? Math.abs(stationChange24h(a)) : -1;
    const bMove = Number.isFinite(stationChange24h(b)) ? Math.abs(stationChange24h(b)) : -1;
    if (bMove !== aMove) return bMove - aMove;
    const distanceDelta = (a.distanceFromVaNcLineMiles ?? Infinity) - (b.distanceFromVaNcLineMiles ?? Infinity);
    if (distanceDelta) return distanceDelta;
    return String(a.id).localeCompare(String(b.id));
  });
}

function chooseDefaultBuoy(stations) {
  const current = stations.find((station) => station.id === mapState.selectedStationId);
  if (current) return current.id;
  return stations.find((station) => !station.isStale && Number.isFinite(stationChange24h(station)))?.id
    || stations.find((station) => !station.isStale)?.id
    || stations[0]?.id
    || null;
}

function stationCalloutLayout(station) {
  const compactMap = (els.buoyMap?.clientWidth || window.innerWidth) < 520;
  const offsets = compactMap ? {
    "44056": [58, 82],
    "44100": [-80, -70],
    "44099": [-96, -82],
    "44014": [78, -78],
    "44086": [-102, 76],
    "44079": [70, 28],
    "41082": [84, 104],
    "41083": [-86, 104]
  } : {
    "44056": [62, 22],
    "44100": [-70, -42],
    "44099": [-42, -48],
    "44014": [92, -50],
    "44086": [-118, 80],
    "44079": [105, 10],
    "41082": [104, 86],
    "41083": [-68, 86]
  };
  const [x, y] = offsets[station.id] || [0, 0];
  const distance = Math.hypot(x, y);
  const calloutRadius = compactMap ? 28 : 42;
  return {
    x,
    y,
    leaderWidth: Math.max(0, distance - calloutRadius),
    leaderAngle: Math.atan2(y, x) * 180 / Math.PI
  };
}

function buoyStationIcon(station) {
  return window.L.divIcon({
    className: "leaflet-div-icon buoy-leaflet-icon",
    html: markerHtml(station),
    iconSize: [1, 1],
    iconAnchor: [0, 0]
  });
}

function markerHtml(station) {
  const temp = stationWaterTemp(station);
  const change = stationChange24h(station);
  const isSelected = mapState.selectedStationId === station.id;
  const isHovered = mapState.hoveredStationId === station.id;
  const layout = stationCalloutLayout(station);
  const stationShortName = station.name?.replace(/,?\s*(VA|NC)$/i, "") || station.id;
  const tempLabel = Number.isFinite(temp) ? `${oneDecimal(temp)}°` : "--";
  const changeLabel = trendBadgeLabel(change);
  return `
    <div
      data-station-id="${escapeHtml(station.id)}"
      aria-label="${escapeHtml(`${station.id} ${station.name}: ${tempLabel} water, ${changeLabel} in 24 hours`)}"
      class="buoy-marker ${station.isStale ? "stale" : ""} ${isSelected ? "selected" : ""} ${isHovered ? "hovered" : ""} ${trendClass(change)}"
      style="--buoy-temp-color:${tempColor(temp)}; --callout-x:${layout.x}px; --callout-y:${layout.y}px; --leader-width:${layout.leaderWidth.toFixed(1)}px; --leader-angle:${layout.leaderAngle.toFixed(1)}deg"
    >
      <span class="buoy-marker-leader" aria-hidden="true"></span>
      <span class="buoy-marker-pin" aria-hidden="true"></span>
      <span class="buoy-marker-callout">
        <strong class="buoy-marker-temp">${escapeHtml(tempLabel)}</strong>
        <span class="buoy-marker-badge">${escapeHtml(changeLabel)}</span>
        <span class="buoy-marker-label">
          <b>${escapeHtml(station.id)}</b>
          <small>${escapeHtml(stationShortName)}</small>
        </span>
      </span>
    </div>
  `;
}

function renderBuoySparkline(points = []) {
  const samples = points
    .filter((point) => Number.isFinite(point.waterTempF) && Number.isFinite(new Date(point.time).getTime()))
    .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
  if (samples.length < 2) {
    return `<div class="buoy-sparkline-empty">Not enough 7d history yet</div>`;
  }

  const width = 240;
  const height = 66;
  const pad = 8;
  const values = samples.map((point) => point.waterTempF);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = max - min || 1;
  const startMs = new Date(samples[0].time).getTime();
  const endMs = new Date(samples.at(-1).time).getTime();
  const timeSpread = endMs - startMs || 1;
  const coords = samples.map((point) => {
    const x = pad + ((new Date(point.time).getTime() - startMs) / timeSpread) * (width - pad * 2);
    const y = pad + (1 - (point.waterTempF - min) / spread) * (height - pad * 2);
    return [x, y];
  });
  const line = coords.map(([x, y], index) => `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`).join(" ");
  const area = `${line} L ${coords.at(-1)[0].toFixed(2)} ${height - pad} L ${coords[0][0].toFixed(2)} ${height - pad} Z`;

  return `
    <svg class="buoy-sparkline" viewBox="0 0 ${width} ${height}" role="img" aria-label="7 day water temperature trend">
      <path class="buoy-sparkline-area" d="${area}"></path>
      <path class="buoy-sparkline-line" d="${line}"></path>
    </svg>
  `;
}

function renderBuoyDetail(station) {
  if (!els.buoyDetail) return;
  if (!station) {
    els.buoyDetail.innerHTML = `<div class="buoy-detail-empty">Select a buoy to see movement.</div>`;
    return;
  }

  const temp = stationWaterTemp(station);
  const change = stationChange24h(station);
  const wave = station.latest?.waveHeightFt;
  const period = station.latest?.dominantPeriodSec;
  const direction = station.latest?.meanWaveDirectionText;
  const range = station.trend?.range7dF;
  const source = station.source || `https://www.ndbc.noaa.gov/station_page.php?station=${encodeURIComponent(station.id)}`;

  els.buoyDetail.innerHTML = `
    <div class="buoy-detail-top">
      <div>
        <p class="eyebrow">${escapeHtml(zoneLabel(station.zone))}</p>
        <h3>${escapeHtml(station.id)} · ${escapeHtml(station.name)}</h3>
        <span class="buoy-freshness ${station.isStale ? "stale" : "fresh"}">${escapeHtml(freshnessLabel(station))} · ${escapeHtml(stationDistanceLabel(station))}</span>
      </div>
      <a class="source-link" href="${escapeHtml(source)}" target="_blank" rel="noreferrer">NOAA</a>
    </div>
    <div class="buoy-detail-main">
      <div>
        <strong>${Number.isFinite(temp) ? `${oneDecimal(temp)}°` : "--"}</strong>
        <span>water now</span>
      </div>
      <div class="${trendClass(change)}">
        <strong>${escapeHtml(movementLabel(change))}</strong>
        <span>24h movement</span>
      </div>
    </div>
    <div class="buoy-detail-grid">
      <div>
        <span>7d range</span>
        <strong>${range ? `${oneDecimal(range.min)}-${oneDecimal(range.max)} °F` : "--"}</strong>
      </div>
      <div>
        <span>Waves</span>
        <strong>${Number.isFinite(wave) ? `${oneDecimal(wave)} ft` : "--"}</strong>
      </div>
      <div>
        <span>Period</span>
        <strong>${Number.isFinite(period) ? `${zeroDecimal(period)} sec` : "--"}</strong>
      </div>
      <div>
        <span>Direction</span>
        <strong>${escapeHtml(direction || "--")}</strong>
      </div>
    </div>
    <div class="buoy-sparkline-wrap">
      ${renderBuoySparkline(station.trend?.series7d)}
    </div>
  `;
}

function renderBuoySummary(stations) {
  const freshStations = stations.filter((station) => !station.isStale && Number.isFinite(stationWaterTemp(station)));
  const movementStations = freshStations.filter((station) => Number.isFinite(stationChange24h(station)));
  const warmest = [...freshStations].sort((a, b) => stationWaterTemp(b) - stationWaterTemp(a))[0];
  const biggestRise = movementStations
    .filter((station) => stationChange24h(station) > 0)
    .sort((a, b) => stationChange24h(b) - stationChange24h(a))[0];
  const biggestDrop = movementStations
    .filter((station) => stationChange24h(station) < 0)
    .sort((a, b) => stationChange24h(a) - stationChange24h(b))[0];

  setText(els.buoyCount, zeroDecimal(freshStations.length));
  setText(els.buoyWarmest, warmest ? `${oneDecimal(stationWaterTemp(warmest))}°` : "--");
  setText(els.buoyRise, biggestRise ? trendBadgeLabel(stationChange24h(biggestRise)) : "--");
  setText(els.buoyDrop, biggestDrop ? trendBadgeLabel(stationChange24h(biggestDrop)) : "--");

  if (els.buoyWarmest) els.buoyWarmest.title = warmest ? `${warmest.id} · ${warmest.name}` : "";
  if (els.buoyRise) els.buoyRise.title = biggestRise ? `${biggestRise.id} · ${biggestRise.name}` : "";
  if (els.buoyDrop) els.buoyDrop.title = biggestDrop ? `${biggestDrop.id} · ${biggestDrop.name}` : "";
}

function renderLeafletBuoys(buoys, stations) {
  const map = ensureBuoyMap(buoys.reference);
  if (!map || !mapState.layer || !mapState.referenceLayer) return;

  mapState.layer.clearLayers();
  mapState.referenceLayer.clearLayers();
  mapState.markers.clear();
  mapState.stations = new Map(stations.map((station) => [station.id, station]));
  mapState.selectedStationId = chooseDefaultBuoy(stations);

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

    const marker = window.L.marker([station.lat, station.lon], {
      icon: buoyStationIcon(station),
      keyboard: true,
      title: `${station.id} · ${station.name}`
    })
      .on("click", () => selectBuoyStation(station.id))
      .on("mouseover", () => {
        mapState.hoveredStationId = station.id;
        updateBuoySelection();
      })
      .on("mouseout", () => {
        if (mapState.hoveredStationId === station.id) {
          mapState.hoveredStationId = null;
          updateBuoySelection();
        }
      })
      .addTo(mapState.layer);
    marker.setZIndexOffset(station.id === mapState.selectedStationId ? 1000 : station.isStale ? -100 : 0);
    mapState.markers.set(station.id, marker);
  }

  if (reference?.lat && reference?.lon) bounds.push([reference.lat, reference.lon]);
  mapState.bounds = bounds;
  fitBuoyMapBounds();

  setTimeout(fitBuoyMapBounds, 0);
  renderBuoyDetail(mapState.stations.get(mapState.selectedStationId));
}

function updateBuoySelection() {
  for (const [stationId, marker] of mapState.markers) {
    const station = mapState.stations.get(stationId);
    if (!station) continue;
    marker.setIcon(buoyStationIcon(station));
    marker.setZIndexOffset(stationId === mapState.selectedStationId || stationId === mapState.hoveredStationId
      ? 1000
      : station.isStale ? -100 : 0);
  }

  els.buoyList?.querySelectorAll(".buoy-list-item").forEach((item) => {
    item.classList.toggle("selected", item.dataset.stationId === mapState.selectedStationId);
    item.setAttribute("aria-pressed", item.dataset.stationId === mapState.selectedStationId ? "true" : "false");
  });
  renderBuoyDetail(mapState.stations.get(mapState.selectedStationId));
}

function selectBuoyStation(stationId, options = {}) {
  const marker = mapState.markers.get(stationId);
  const station = mapState.stations.get(stationId);
  if (!marker || !station || !mapState.map) return;

  mapState.selectedStationId = stationId;
  updateBuoySelection();

  const latLng = marker.getLatLng();
  if (options.pan !== false) {
    mapState.map.flyTo(latLng, Math.max(mapState.map.getZoom(), 7.65), { duration: 0.45 });
  }
}

function renderBuoyList(stations) {
  if (!els.buoyList) return;
  els.buoyList.innerHTML = stations.map((station) => {
    const temp = stationWaterTemp(station);
    const change = stationChange24h(station);
    const wave = station.latest?.waveHeightFt;
    const status = station.error
      ? station.error
      : `${freshnessLabel(station)} · ${Number.isFinite(wave) ? `${oneDecimal(wave)} ft waves` : zoneLabel(station.zone)}`;
    return `
      <button class="buoy-list-item ${station.isStale ? "stale" : ""} ${trendClass(change)}" type="button" data-station-id="${escapeHtml(station.id)}" aria-pressed="false" aria-label="Show ${escapeHtml(station.name)} on the buoy map">
        <span class="buoy-chip-main">
          <strong>${escapeHtml(station.id)} · ${escapeHtml(station.name)}</strong>
          <span>${escapeHtml(status)}</span>
        </span>
        <span class="buoy-chip-values">
          <strong class="buoy-temp">${Number.isFinite(temp) ? `${oneDecimal(temp)}°` : "--"}</strong>
          <span class="buoy-movement">${escapeHtml(trendBadgeLabel(change))}</span>
        </span>
      </button>
    `;
  }).join("");
  els.buoyList.querySelectorAll(".buoy-list-item").forEach((item) => {
    item.addEventListener("click", () => selectBuoyStation(item.dataset.stationId));
  });
  updateBuoySelection();
}

function renderAlerts(errors) {
  const messages = Object.entries(errors || {})
    .filter(([, value]) => value)
    .map(([key, value]) => `${key}: ${value}`);

  els.alerts.hidden = messages.length === 0;
  els.alerts.innerHTML = messages.map((message) => `<div class="alert">${message}</div>`).join("");
}

function chartRenderedWidth(svg) {
  return svg?.clientWidth || svg?.parentElement?.clientWidth || window.innerWidth;
}

function chartRenderedAspect(svg, fallback = 16 / 9) {
  const rect = svg?.getBoundingClientRect?.();
  const width = rect?.width || svg?.clientWidth || svg?.parentElement?.clientWidth;
  const height = rect?.height || svg?.clientHeight || svg?.parentElement?.clientHeight;
  return Number.isFinite(width) && Number.isFinite(height) && height > 0
    ? width / height
    : fallback;
}

function renderBuoyMap(buoys, trends) {
  if (!buoys?.stations?.length) {
    setText(els.buoyCount, "--");
    setText(els.buoyWarmest, "--");
    setText(els.buoyRise, "--");
    setText(els.buoyDrop, "--");
    setText(els.buoyNote, "No NOAA buoy station data is available right now.");
    if (els.buoyList) els.buoyList.innerHTML = "";
    renderBuoyDetail(null);
    if (mapState.layer) mapState.layer.clearLayers();
    return;
  }

  mapState.trends = new Map((trends?.stations || []).map((trend) => [trend.stationId, trend]));
  const stations = sortBuoyStations(mergeBuoyTrends(buoys.stations, trends));
  renderBuoySummary(stations);
  setText(els.buoyNote, "Stale reports are muted and excluded from fresh movement summaries.");
  renderLeafletBuoys(buoys, stations);
  renderBuoyList(stations);
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
  const palette = getThemePalette();
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
  const compactTide = chartRenderedWidth(svg) < 430;
  const visibleTideCount = compactTide ? 4 : 5;
  const nextIndex = uniquePredictions.findIndex((point) => new Date(point.time).getTime() > now);
  const startIndex = nextIndex === -1 ? Math.max(0, uniquePredictions.length - visibleTideCount) : Math.max(0, nextIndex - 1);
  const visible = uniquePredictions.slice(startIndex, startIndex + visibleTideCount);
  if (visible.length < 2) {
    svg.innerHTML = "";
    return;
  }

  const height = 150;
  const width = Math.round(height * chartRenderedAspect(svg, 520 / height));
  const padX = compactTide ? 30 : 34;
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
    <path d="${area}" fill="${palette.tide.fill}"></path>
    <path d="${line}" fill="none" stroke="${palette.tide.line}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"></path>
    ${visible.map((point) => {
      const x = xForTime(point.time);
      const y = yForValue(point.valueFt);
      const isHigh = point.type === "High";
      const labelY = isHigh ? Math.max(13, y - 12) : Math.min(height - 10, y + 22);
      const tideLabel = compactTide
        ? `${isHigh ? "H" : "L"} ${oneDecimal(point.valueFt)}`
        : `${isHigh ? "High" : "Low"} ${oneDecimal(point.valueFt)} ft`;
      return `
        <line class="tide-chart-marker" x1="${x.toFixed(2)}" x2="${x.toFixed(2)}" y1="${padTop}" y2="${baselineY}"></line>
        <circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="6" class="tide-chart-dot ${isHigh ? "high" : "low"}"></circle>
        <text class="tide-chart-label" x="${x.toFixed(2)}" y="${labelY.toFixed(2)}" text-anchor="middle">${tideLabel}</text>
        <text class="tide-chart-time" x="${x.toFixed(2)}" y="${height - 8}" text-anchor="middle">${escapeHtml(hourLabel(point.time))}</text>
      `;
    }).join("")}
    ${Number.isFinite(nowX) ? `
      <line class="tide-chart-now" x1="${nowX.toFixed(2)}" x2="${nowX.toFixed(2)}" y1="${padTop}" y2="${baselineY}" style="stroke:${palette.tide.nowLine}"></line>
      <text class="tide-chart-now-label" x="${nowX.toFixed(2)}" y="${padTop + 10}" text-anchor="middle" style="fill:${palette.tide.nowLabel}">Now</text>
    ` : ""}
    <g class="chart-cursor" opacity="0">
      <line class="chart-cursor-line" x1="${padX}" x2="${padX}" y1="${padTop}" y2="${baselineY}" stroke="${palette.tide.cursorLine}"></line>
      <circle class="chart-cursor-dot" cx="${padX}" cy="${padTop}" r="6" fill="${palette.tide.cursorLine}"></circle>
      <rect class="chart-cursor-bg" x="${padX}" y="${padTop}" width="112" height="34" rx="8" fill="${palette.tide.cursorBg}"></rect>
      <text class="chart-cursor-value" x="${padX}" y="${padTop}" text-anchor="middle" fill="${palette.tide.cursorText}"></text>
      <text class="chart-cursor-time" x="${padX}" y="${padTop}" text-anchor="middle" fill="${palette.tide.cursorText}"></text>
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
      : weather?.wind || "--");
    setText(els.marinePressure, Number.isFinite(marine.latest.pressureHpa)
      ? `${hpaToInHg(marine.latest.pressureHpa).toFixed(2)} in`
      : Number.isFinite(weather?.pressureInHg)
        ? `${weather.pressureInHg.toFixed(2)} in`
        : "--");
    const weatherDewPointF = Number.isFinite(weather?.dewPointF)
      ? weather.dewPointF
      : dewPointFromHumidityF(weather?.temperatureF, weather?.humidity);
    setText(els.marineDew, Number.isFinite(marine.latest.dewPointF)
      ? `${oneDecimal(marine.latest.dewPointF)} °F`
      : Number.isFinite(weatherDewPointF)
        ? `${oneDecimal(weatherDewPointF)} °F`
        : "--");
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
  renderBuoyMap(buoys, data.buoyTrends);
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

els.surfChartMode?.querySelectorAll("button[data-surf-series]").forEach((button) => {
  button.addEventListener("click", () => {
    chartState.surfSeries = button.dataset.surfSeries === "water" ? "water" : "waves";
    renderTopCharts();
  });
});

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
window.addEventListener("resize", scheduleBuoyMapResize);

function initializeTheme() {
  themePreference = readThemePreference();

  if (themeMediaQuery?.addEventListener) {
    themeMediaQuery.addEventListener("change", onSystemThemeChange);
  } else if (themeMediaQuery?.addListener) {
    themeMediaQuery.addListener(onSystemThemeChange);
  }

  els.themeToggle?.addEventListener("click", toggleTheme);
  setThemePreference(themePreference);
}

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
    snapshot.buoyTrends = await fetchBuoyTrends();
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

initializeTheme();
load();
setInterval(updateCacheStatus, 1000);
