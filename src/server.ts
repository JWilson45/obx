import { getCachedSnapshot, getDatabaseStats, getHistory, normalizeHistoryLimit, persistSnapshot } from "./db";
import { stat } from "node:fs/promises";

const PORT = Number(Bun.env.PORT || 3000);
const USER_AGENT = "obx-conditions/0.1 contact: local-dashboard";
const SNAPSHOT_CACHE_MS = 2 * 60 * 1000;
const WEATHERSTEM_STATION = "ccemcarovabeach@currituck.weatherstem.com";
const CAROVA_BEACH_REFERENCE = {
  name: "Carova Beach oceanfront",
  lat: 36.517,
  lon: -75.867
};
const VA_NC_LINE_REFERENCE = {
  name: "VA/NC line oceanfront",
  lat: 36.5506,
  lon: -75.8703
};
const CHART_WINDOWS_DAYS = [1, 7, 30] as const;

type Point = {
  time: string;
  value?: number;
  waveHeightFt?: number;
  waterTempF?: number;
};

type ApiErrorMap = Record<string, string>;

type BuoyStationConfig = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  zone: "near-border" | "northern" | "offshore" | "southern-reference";
};

const SOURCES = {
  usgs: "https://waterservices.usgs.gov/nwis/iv/?format=json&sites=02043433&parameterCd=00065&period=P30D&siteStatus=all",
  ndbcRealtime: "https://www.ndbc.noaa.gov/data/realtime2/44056.txt",
  ndbcSpectral: "https://www.ndbc.noaa.gov/data/realtime2/44056.spec",
  weatherStemPortal: "https://currituck.weatherstem.com/",
  weatherStemApi: "https://api.weatherstem.com/api",
  nwsPoint: "https://api.weather.gov/points/36.517,-75.867",
  coopsPredictions: "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter"
};

const ATLANTIC_TIDE_STATION = {
  id: "8639428",
  name: "Sandbridge, VA",
  lat: 36.6917,
  lon: -75.92,
  datum: "MLLW"
};

const BUOY_STATIONS: BuoyStationConfig[] = [
  { id: "44099", name: "Cape Henry, VA", lat: 36.915, lon: -75.722, zone: "northern" },
  { id: "44014", name: "Virginia Beach 64 NM East", lat: 36.603, lon: -74.837, zone: "offshore" },
  { id: "44079", name: "OOI Pioneer Northern Surface Mooring", lat: 36.175, lon: -74.827, zone: "offshore" },
  { id: "41082", name: "OOI Pioneer Central Surface Mooring", lat: 35.95, lon: -75.125, zone: "offshore" },
  { id: "41083", name: "OOI Pioneer Southern Surface Mooring", lat: 35.725, lon: -74.853, zone: "offshore" },
  { id: "44056", name: "Duck FRF", lat: 36.2, lon: -75.714, zone: "near-border" },
  { id: "44100", name: "Duck FRF 26m", lat: 36.258, lon: -75.593, zone: "near-border" },
  { id: "44086", name: "Nags Head, NC", lat: 36.001, lon: -75.421, zone: "southern-reference" }
];

let snapshotRefresh: Promise<any> | undefined;

function json(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers
    }
  });
}

function assetHeaders(pathname: string, stats: { size: number; mtimeMs: number }) {
  const isHtml = pathname === "/" || pathname.endsWith(".html");
  const isImage = /\.(?:png|jpg|jpeg|webp|gif|ico|svg)$/i.test(pathname);
  const etag = `"${stats.size.toString(16)}-${Math.round(stats.mtimeMs).toString(16)}"`;
  return {
    etag,
    "cache-control": isHtml
      ? "no-cache"
      : isImage
        ? "public, max-age=86400, stale-while-revalidate=604800"
        : "public, max-age=0, must-revalidate",
    "last-modified": new Date(stats.mtimeMs).toUTCString()
  };
}

async function publicAsset(request: Request, pathname: string) {
  const decoded = decodeURIComponent(pathname);
  if (decoded.includes("..") || decoded.includes("\\")) {
    return undefined;
  }

  const filePath = decoded === "/" ? "public/index.html" : `public${decoded}`;
  const file = Bun.file(filePath);
  if (!(await file.exists())) return undefined;
  const headers = assetHeaders(decoded, await stat(filePath));
  if (request.headers.get("if-none-match") === headers.etag) {
    return new Response(null, {
      status: 304,
      headers
    });
  }
  return new Response(file, { headers });
}

async function fetchText(url: string) {
  const response = await fetch(url, {
    headers: {
      "accept": "*/*",
      "user-agent": USER_AGENT
    }
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }

  return response.text();
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "accept": "application/geo+json, application/json, text/plain",
      "user-agent": USER_AGENT,
      ...init?.headers
    }
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }

  return response.json();
}

function asNumber(value: unknown) {
  if (value === "MM" || value === "N/A" || value === "" || value == null) return undefined;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function cToF(value?: number) {
  return Number.isFinite(value) ? value * 9 / 5 + 32 : undefined;
}

function metersToFeet(value?: number) {
  return Number.isFinite(value) ? value * 3.28084 : undefined;
}

function mpsToMph(value?: number) {
  return Number.isFinite(value) ? value * 2.23694 : undefined;
}

function paToInHg(value?: number) {
  return Number.isFinite(value) ? value / 3386.389 : undefined;
}

function dewPointFromHumidityF(temperatureF?: number, humidity?: number) {
  if (!Number.isFinite(temperatureF) || !Number.isFinite(humidity) || humidity! <= 0) return undefined;
  const temperatureC = (temperatureF! - 32) * 5 / 9;
  const alpha = Math.log(humidity! / 100) + (17.625 * temperatureC) / (243.04 + temperatureC);
  return ((243.04 * alpha) / (17.625 - alpha)) * 9 / 5 + 32;
}

function directionFromDegrees(degrees?: number) {
  if (!Number.isFinite(degrees)) return undefined;
  const names = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return names[Math.round(degrees / 22.5) % 16];
}

function isoUtc(parts: string[]) {
  const [year, month, day, hour, minute] = parts.map(Number);
  return new Date(Date.UTC(year, month - 1, day, hour, minute)).toISOString();
}

function downsample<T>(items: T[], target = 96): T[] {
  if (items.length <= target) return items;
  if (target <= 1) return [items.at(-1)!];

  const lastIndex = items.length - 1;
  const sampled: T[] = [];
  let previousIndex = -1;
  for (let index = 0; index < target; index++) {
    const itemIndex = Math.round((index / (target - 1)) * lastIndex);
    if (itemIndex === previousIndex) continue;
    sampled.push(items[itemIndex]);
    previousIndex = itemIndex;
  }
  return sampled;
}

function recentWindow<T extends { time: string }>(items: T[], days: number, latestTime?: string) {
  const latestMs = latestTime ? new Date(latestTime).getTime() : new Date(items.at(-1)?.time ?? "").getTime();
  if (!Number.isFinite(latestMs)) return items;
  const cutoff = latestMs - days * 24 * 60 * 60 * 1000;
  return items.filter((item) => new Date(item.time).getTime() >= cutoff);
}

function seriesByDays<T extends { time: string }>(items: T[], target = 120) {
  return Object.fromEntries(
    CHART_WINDOWS_DAYS.map((days) => [String(days), downsample(recentWindow(items, days), target)])
  );
}

function rangeByDays<T extends { time: string }>(items: T[], key: keyof T) {
  return Object.fromEntries(CHART_WINDOWS_DAYS.map((days) => {
    const values = recentWindow(items, days)
      .map((item) => item[key])
      .filter(Number.isFinite) as number[];
    return [String(days), values.length ? { min: Math.min(...values), max: Math.max(...values) } : undefined];
  }));
}

function changeByHours<T extends { time: string }>(items: T[], key: keyof T, hours: number) {
  const valid = items
    .filter((item) => Number.isFinite(item[key]) && Number.isFinite(new Date(item.time).getTime()))
    .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
  const latest = valid.at(-1);
  if (!latest) return undefined;

  const targetMs = new Date(latest.time).getTime() - hours * 60 * 60 * 1000;
  const previous = [...valid].reverse().find((item) => new Date(item.time).getTime() <= targetMs);
  return previous ? (latest[key] as number) - (previous[key] as number) : undefined;
}

function milesBetween(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const earthRadiusMiles = 3958.8;
  const toRad = (value: number) => value * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * earthRadiusMiles * Math.asin(Math.sqrt(h));
}

function yyyymmdd(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function addDays(date: Date, days: number) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function parseNoaaUtcTime(value: unknown) {
  return new Date(`${String(value).replace(" ", "T")}:00Z`).toISOString();
}

function omitHistory<T extends Record<string, unknown> | undefined>(value: T): T {
  if (!value) return value;
  const copy = { ...value };
  delete copy.history;
  return copy as T;
}

function omitBuoyHistory(value: Awaited<ReturnType<typeof getBuoyNetwork>> | undefined) {
  if (!value) return value;
  return {
    ...value,
    stations: value.stations.map((station) => {
      const copy = { ...station };
      delete copy.history;
      return copy;
    })
  };
}

async function getSoundLevel() {
  const data: any = await fetchJson(SOURCES.usgs);
  const timeSeries = data?.value?.timeSeries?.[0];
  const values = timeSeries?.values?.[0]?.value ?? [];
  const series = values
    .map((entry: any) => ({ time: entry.dateTime, value: asNumber(entry.value) }))
    .filter((entry: Point) => Number.isFinite(entry.value));

  const latest = series.at(-1);
  const latestTime = latest ? new Date(latest.time).getTime() : 0;
  const dayAgo = latestTime - 24 * 60 * 60 * 1000;
  const previous24h = [...series].reverse().find((entry) => new Date(entry.time).getTime() <= dayAgo);
  const allValues = series.map((entry) => entry.value).filter(Number.isFinite) as number[];

  return {
    siteName: timeSeries?.sourceInfo?.siteName ?? "CURRITUCK SOUND ON EAST BANK AT COROLLA, NC",
    latest,
    change24h: latest && previous24h ? latest.value! - previous24h.value! : undefined,
    range: {
      min: Math.min(...allValues),
      max: Math.max(...allValues)
    },
    rangeByDays: rangeByDays(series, "value"),
    history: series,
    series: downsample(recentWindow(series, 7), 120),
    seriesByDays: seriesByDays(series, 120),
    source: SOURCES.usgs
  };
}

function parseNdbcRealtime(text: string) {
  const rows = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => line.split(/\s+/));

  const series = rows.map((cols) => {
    const waveHeightM = asNumber(cols[8]);
    const airTempC = asNumber(cols[13]);
    const waterTempC = asNumber(cols[14]);
    const dewPointC = asNumber(cols[15]);

    return {
      time: isoUtc(cols.slice(0, 5)),
      windDirectionDeg: asNumber(cols[5]),
      windSpeedMps: asNumber(cols[6]),
      windGustMps: asNumber(cols[7]),
      waveHeightFt: metersToFeet(waveHeightM),
      dominantPeriodSec: asNumber(cols[9]),
      averagePeriodSec: asNumber(cols[10]),
      meanWaveDirectionDeg: asNumber(cols[11]),
      meanWaveDirectionText: directionFromDegrees(asNumber(cols[11])),
      pressureHpa: asNumber(cols[12]),
      airTempF: cToF(airTempC),
      waterTempF: cToF(waterTempC),
      dewPointF: cToF(dewPointC),
      visibilityNmi: asNumber(cols[16]),
      pressureTendencyHpa: asNumber(cols[17]),
      tideFt: asNumber(cols[18])
    };
  });

  return series;
}

function parseNdbcSpectral(text: string) {
  const first = text
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith("#"));

  if (!first) return undefined;
  const cols = first.split(/\s+/);

  return {
    time: isoUtc(cols.slice(0, 5)),
    waveHeightFt: metersToFeet(asNumber(cols[5])),
    swellHeightFt: metersToFeet(asNumber(cols[6])),
    swellPeriodSec: asNumber(cols[7]),
    windWaveHeightFt: metersToFeet(asNumber(cols[8])),
    windWavePeriodSec: asNumber(cols[9]),
    swellDirection: cols[10] === "MM" ? undefined : cols[10],
    windWaveDirection: cols[11] === "MM" ? undefined : cols[11],
    steepness: cols[12] === "N/A" ? undefined : cols[12],
    averagePeriodSec: asNumber(cols[13]),
    meanWaveDirectionDeg: asNumber(cols[14])
  };
}

async function getMarine() {
  const [realtimeText, spectralText] = await Promise.all([
    fetchText(SOURCES.ndbcRealtime),
    fetchText(SOURCES.ndbcSpectral)
  ]);

  const series = parseNdbcRealtime(realtimeText);
  const chronologicalSeries = [...series].reverse();
  return {
    station: "44056 - Duck FRF, NC",
    latest: series[0],
    history: series,
    series: downsample(recentWindow(chronologicalSeries, 7), 120),
    seriesByDays: seriesByDays(chronologicalSeries, 120),
    waterTempRangeByDays: rangeByDays(chronologicalSeries, "waterTempF"),
    waterTempChange24h: changeByHours(chronologicalSeries, "waterTempF", 24),
    spectral: parseNdbcSpectral(spectralText),
    source: "https://www.ndbc.noaa.gov/station_page.php?station=44056"
  };
}

async function getAtlanticTide() {
  const today = new Date();
  const params = new URLSearchParams({
    product: "predictions",
    application: "obx_conditions",
    begin_date: yyyymmdd(addDays(today, -1)),
    range: "72",
    datum: ATLANTIC_TIDE_STATION.datum,
    station: ATLANTIC_TIDE_STATION.id,
    time_zone: "gmt",
    units: "english",
    interval: "hilo",
    format: "json"
  });
  const apiUrl = `${SOURCES.coopsPredictions}?${params}`;
  const data: any = await fetchJson(apiUrl);
  const predictions = (data?.predictions ?? []).map((prediction: any) => ({
    time: parseNoaaUtcTime(prediction.t),
    localTime: `${prediction.t} UTC`,
    valueFt: asNumber(prediction.v),
    type: prediction.type === "H" ? "High" : prediction.type === "L" ? "Low" : prediction.type
  }));
  const now = Date.now();
  const previous = [...predictions].reverse().find((prediction) => new Date(prediction.time).getTime() <= now);
  const upcoming = predictions.filter((prediction) => new Date(prediction.time).getTime() > now);

  return {
    station: ATLANTIC_TIDE_STATION,
    reference: VA_NC_LINE_REFERENCE,
    distanceFromCarovaMiles: milesBetween(CAROVA_BEACH_REFERENCE, ATLANTIC_TIDE_STATION),
    distanceFromReferenceMiles: milesBetween(VA_NC_LINE_REFERENCE, ATLANTIC_TIDE_STATION),
    source: `https://tidesandcurrents.noaa.gov/stationhome.html?id=${ATLANTIC_TIDE_STATION.id}`,
    api: apiUrl,
    previous,
    next: upcoming[0],
    upcoming: upcoming.slice(0, 5),
    predictions
  };
}

async function getBuoyStation(config: BuoyStationConfig) {
  const source = `https://www.ndbc.noaa.gov/station_page.php?station=${config.id}`;
  const text = await fetchText(`https://www.ndbc.noaa.gov/data/realtime2/${config.id}.txt`);
  const history = parseNdbcRealtime(text);
  const latest = history.find((point) => Number.isFinite(point.waterTempF)) ?? history[0];
  const latestAgeHours = latest ? (Date.now() - new Date(latest.time).getTime()) / (60 * 60 * 1000) : undefined;

  return {
    ...config,
    source,
    distanceFromVaNcLineMiles: milesBetween(VA_NC_LINE_REFERENCE, config),
    latest,
    latestAgeHours,
    isStale: Number.isFinite(latestAgeHours) ? latestAgeHours! > 24 : true,
    history
  };
}

async function getBuoyNetwork() {
  const results = await Promise.allSettled(BUOY_STATIONS.map(getBuoyStation));
  const stations = results
    .map((result, index) => {
      if (result.status === "fulfilled") return result.value;

      const config = BUOY_STATIONS[index];
      return {
        ...config,
        source: `https://www.ndbc.noaa.gov/station_page.php?station=${config.id}`,
        distanceFromVaNcLineMiles: milesBetween(VA_NC_LINE_REFERENCE, config),
        error: result.reason?.message ?? "NDBC feed failed",
        history: []
      };
    })
    .sort((a, b) => a.distanceFromVaNcLineMiles - b.distanceFromVaNcLineMiles);

  const freshStations = stations.filter((station) => station.latest && !station.isStale);
  const waterTemps = freshStations
    .map((station) => station.latest?.waterTempF)
    .filter(Number.isFinite) as number[];

  return {
    reference: VA_NC_LINE_REFERENCE,
    stations,
    freshStationCount: freshStations.length,
    temperatureRangeF: waterTemps.length
      ? { min: Math.min(...waterTemps), max: Math.max(...waterTemps) }
      : undefined,
    source: "https://www.ndbc.noaa.gov/"
  };
}

async function getWeatherStemPortalTemp() {
  const html = await fetchText(SOURCES.weatherStemPortal);
  const pattern = /CCEM Carova Beach Fire Department[\s\S]*?Current temperature:\s*([\d.]+)\s*(?:°|&deg;)\s*F/i;
  const match = html.match(pattern);
  return match ? Number(match[1]) : undefined;
}

async function getWeatherStemApi() {
  const apiKey = Bun.env.WEATHERSTEM_API_KEY;
  if (!apiKey) return undefined;

  const input = JSON.stringify({
    api_key: apiKey,
    stations: [WEATHERSTEM_STATION]
  });

  return fetchJson(SOURCES.weatherStemApi, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: input
  });
}

function findWeatherStemSensor(data: unknown, sensorNames: string[]) {
  const wanted = sensorNames.map((name) => name.toLowerCase());
  const stack = [data];

  while (stack.length) {
    const value = stack.pop();
    if (!value || typeof value !== "object") continue;

    if (Array.isArray(value)) {
      stack.push(...value);
      continue;
    }

    const record = value as Record<string, unknown>;
    const keys = Object.keys(record);
    const name = String(record.sensor ?? record.name ?? record.label ?? record.type ?? "").toLowerCase();
    if (wanted.some((item) => name.includes(item))) {
      const reading = record.value ?? record.reading ?? record.current ?? record.measurement;
      const numeric = asNumber(reading);
      if (Number.isFinite(numeric)) return numeric;
    }

    for (const key of keys) stack.push(record[key]);
  }

  return undefined;
}

async function getNwsWeather() {
  const point: any = await fetchJson(SOURCES.nwsPoint);
  const forecastUrl = point?.properties?.forecast;
  const forecastHourlyUrl = point?.properties?.forecastHourly;
  const stationsUrl = point?.properties?.observationStations;

  const [forecast, hourlyForecast, stations]: any[] = await Promise.all([
    forecastUrl ? fetchJson(forecastUrl) : undefined,
    forecastHourlyUrl ? fetchJson(forecastHourlyUrl) : undefined,
    fetchJson(stationsUrl)
  ]);

  const periods = hourlyForecast?.properties?.periods ?? [];
  const dailyPeriods = forecast?.properties?.periods ?? [];
  const firstPeriod = periods[0] ?? dailyPeriods[0];
  const firstStation = stations?.features?.[0]?.properties?.stationIdentifier;
  const latestObs = firstStation
    ? await fetchJson<any>(`https://api.weather.gov/stations/${firstStation}/observations/latest`)
    : undefined;
  const props = latestObs?.properties ?? {};

  return {
    station: firstStation,
    temperatureF: cToF(asNumber(props.temperature?.value)),
    dewPointF: cToF(asNumber(props.dewpoint?.value)),
    humidity: asNumber(props.relativeHumidity?.value),
    pressureInHg: paToInHg(asNumber(props.barometricPressure?.value)),
    windDirection: directionFromDegrees(asNumber(props.windDirection?.value)),
    windSpeedMph: mpsToMph(asNumber(props.windSpeed?.value)),
    windGustMph: mpsToMph(asNumber(props.windGust?.value)),
    summary: props.textDescription || firstPeriod?.shortForecast,
    forecastTemperatureF: asNumber(firstPeriod?.temperature),
    forecastWind: `${firstPeriod?.windDirection ?? ""} ${firstPeriod?.windSpeed ?? ""}`.trim(),
    precipChance: asNumber(firstPeriod?.probabilityOfPrecipitation?.value),
    forecast: periods.slice(0, 8).map((period: any) => ({
      time: period.startTime,
      temperatureF: asNumber(period.temperature),
      shortForecast: period.shortForecast,
      windSpeed: period.windSpeed,
      windDirection: period.windDirection,
      precipChance: asNumber(period.probabilityOfPrecipitation?.value)
    })),
    dailyForecast: dailyPeriods
      .filter((period: any) => period.isDaytime)
      .slice(0, 5)
      .map((period: any) => ({
        name: period.name,
        time: period.startTime,
        temperatureF: asNumber(period.temperature),
        shortForecast: period.shortForecast,
        detailedForecast: period.detailedForecast,
        windSpeed: period.windSpeed,
        windDirection: period.windDirection,
        precipChance: asNumber(period.probabilityOfPrecipitation?.value)
    }))
  };
}

async function getWeather() {
  const [weatherStemTemp, weatherStemApi, nws] = await Promise.allSettled([
    getWeatherStemPortalTemp(),
    getWeatherStemApi(),
    getNwsWeather()
  ]);

  const stemTemp = weatherStemTemp.status === "fulfilled" ? weatherStemTemp.value : undefined;
  const stemData = weatherStemApi.status === "fulfilled" ? weatherStemApi.value : undefined;
  const nwsData = nws.status === "fulfilled" ? nws.value : undefined;

  const apiTemp = stemData ? findWeatherStemSensor(stemData, ["thermometer", "temperature"]) : undefined;
  const apiHumidity = stemData ? findWeatherStemSensor(stemData, ["hygrometer", "humidity"]) : undefined;
  const apiPressure = stemData ? findWeatherStemSensor(stemData, ["barometer", "pressure"]) : undefined;
  const apiDewPoint = stemData ? findWeatherStemSensor(stemData, ["dew point", "dewpoint"]) : undefined;

  const wind = nwsData?.forecastWind ||
    (Number.isFinite(nwsData?.windSpeedMph) ? `${nwsData?.windDirection ?? ""} ${Math.round(nwsData!.windSpeedMph!)} mph`.trim() : undefined);
  const temperatureF = apiTemp ?? stemTemp ?? nwsData?.temperatureF ?? nwsData?.forecastTemperatureF;
  const humidity = apiHumidity ?? nwsData?.humidity;

  return {
    source: "https://currituck.weatherstem.com/ccemcarovabeach",
    station: "CCEM Carova Beach Fire Department",
    temperatureF,
    humidity,
    pressureInHg: apiPressure ?? nwsData?.pressureInHg,
    dewPointF: apiDewPoint ?? nwsData?.dewPointF ?? dewPointFromHumidityF(temperatureF, humidity),
    wind,
    precipChance: nwsData?.precipChance,
    summary: nwsData?.summary,
    forecast: nwsData?.forecast,
    dailyForecast: nwsData?.dailyForecast,
    note: Bun.env.WEATHERSTEM_API_KEY
      ? "WeatherSTEM API key is configured; NWS fills forecast-only fields."
      : "WeatherSTEM public portal provides the fire-station temperature. Full station sensors require a WeatherSTEM API key; NWS point forecast and nearest official observations fill the remaining fields."
  };
}

async function getLiveSnapshot() {
  const errors: ApiErrorMap = {};
  const [sound, marine, weather, buoys, tide] = await Promise.allSettled([
    getSoundLevel(),
    getMarine(),
    getWeather(),
    getBuoyNetwork(),
    getAtlanticTide()
  ]);

  if (sound.status === "rejected") errors.sound = sound.reason?.message ?? "USGS feed failed";
  if (marine.status === "rejected") errors.marine = marine.reason?.message ?? "NOAA NDBC feed failed";
  if (weather.status === "rejected") errors.weather = weather.reason?.message ?? "Weather feed failed";
  if (buoys.status === "rejected") errors.buoys = buoys.reason?.message ?? "NOAA buoy network failed";
  if (tide.status === "rejected") errors.tide = tide.reason?.message ?? "NOAA CO-OPS tide feed failed";

  const snapshot = {
    generatedAt: new Date().toISOString(),
    sound: sound.status === "fulfilled" ? sound.value : undefined,
    marine: marine.status === "fulfilled" ? marine.value : undefined,
    weather: weather.status === "fulfilled" ? weather.value : undefined,
    buoys: buoys.status === "fulfilled" ? buoys.value : undefined,
    tide: tide.status === "fulfilled" ? tide.value : undefined,
    errors
  };

  try {
    persistSnapshot(snapshot);
  } catch (error) {
    snapshot.errors.persistence = error instanceof Error ? error.message : "SQLite persistence failed";
  }

  return {
    ...snapshot,
    sound: omitHistory(snapshot.sound),
    marine: omitHistory(snapshot.marine),
    buoys: omitBuoyHistory(snapshot.buoys)
  };
}

function withCacheMetadata(snapshot: any, cacheStatus: "fresh" | "cached") {
  const generatedAtMs = new Date(snapshot.generatedAt).getTime();
  const ageSeconds = Number.isFinite(generatedAtMs)
    ? Math.max(0, Math.round((Date.now() - generatedAtMs) / 1000))
    : undefined;
  return {
    ...snapshot,
    cache: {
      status: cacheStatus,
      maxAgeSeconds: Math.round(SNAPSHOT_CACHE_MS / 1000),
      ageSeconds,
      nextRefreshAt: Number.isFinite(generatedAtMs)
        ? new Date(generatedAtMs + SNAPSHOT_CACHE_MS).toISOString()
        : undefined
    }
  };
}

async function getSnapshot() {
  const cached = getCachedSnapshot(SNAPSHOT_CACHE_MS);
  if (cached) return withCacheMetadata(cached, "cached");

  snapshotRefresh ??= getLiveSnapshot().finally(() => {
    snapshotRefresh = undefined;
  });

  return withCacheMetadata(await snapshotRefresh, "fresh");
}

if (Bun.argv.includes("--once")) {
  const snapshot = await getSnapshot();
  console.log(JSON.stringify({
    ok: true,
    generatedAt: snapshot.generatedAt,
    hasSound: Boolean(snapshot.sound?.latest),
    hasMarine: Boolean(snapshot.marine?.latest),
    hasWeather: Boolean(snapshot.weather?.temperatureF),
    hasBuoys: Boolean(snapshot.buoys?.stations?.length),
    hasTide: Boolean(snapshot.tide?.next),
    errors: snapshot.errors
  }, null, 2));
  process.exit(Object.keys(snapshot.errors).length ? 1 : 0);
}

Bun.serve({
  port: PORT,
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/api/snapshot") {
      try {
        return json(await getSnapshot(), 200, {
          "cache-control": "private, max-age=120, stale-while-revalidate=300"
        });
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : "Unknown server error" }, 500);
      }
    }

    if (url.pathname === "/api/history") {
      const kind = url.searchParams.get("kind") || "snapshots";
      const limit = Number(url.searchParams.get("limit") || 250);
      const safeLimit = normalizeHistoryLimit(limit);
      return json({
        kind,
        limit: safeLimit,
        rows: getHistory(kind, safeLimit)
      });
    }

    if (url.pathname === "/api/db/stats") {
      return json(getDatabaseStats());
    }

    const staticResponse = await publicAsset(request, url.pathname);
    if (staticResponse) {
      return staticResponse;
    }

    return new Response("Not found", { status: 404 });
  }
});

console.log(`OBX Conditions running at http://localhost:${PORT}`);
