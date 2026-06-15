import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";

type Snapshot = {
  generatedAt: string;
  sound?: any;
  marine?: any;
  weather?: any;
  buoys?: any;
  tide?: any;
  errors?: Record<string, string>;
};

const DB_PATH = Bun.env.DB_PATH || "data/obx.sqlite";
const SNAPSHOT_RETENTION_DAYS = Math.max(Number(Bun.env.SNAPSHOT_RETENTION_DAYS || 14), 1);
let db: Database | undefined;

function valueOrNull(value: unknown) {
  return value === undefined ? null : value;
}

function toJson(value: unknown) {
  return JSON.stringify(value ?? null);
}

function compactJson(value: any) {
  if (!value || typeof value !== "object") return toJson(value);
  const copy = { ...value };
  delete copy.history;
  return toJson(copy);
}

function compactSnapshot(value: Snapshot) {
  return {
    ...value,
    sound: compactEntity(value.sound),
    marine: compactEntity(value.marine),
    buoys: value.buoys
      ? {
          ...value.buoys,
          stations: value.buoys.stations?.map(compactEntity) ?? []
        }
      : value.buoys
  };
}

function compactEntity<T extends Record<string, any> | undefined>(value: T): T {
  if (!value) return value;
  const copy = { ...value };
  delete copy.history;
  return copy as T;
}

function isOlderThan(referenceTime: string, observationTime: string, hours: number) {
  const reference = new Date(referenceTime).getTime();
  const observation = new Date(observationTime).getTime();
  if (!Number.isFinite(reference) || !Number.isFinite(observation)) return true;
  return reference - observation > hours * 60 * 60 * 1000;
}

export function normalizeHistoryLimit(limit = 250) {
  const parsed = Number(limit);
  const safe = Number.isFinite(parsed) ? parsed : 250;
  return Math.min(Math.max(Math.trunc(safe), 1), 2000);
}

function getDb() {
  if (db) return db;

  mkdirSync(dirname(DB_PATH), { recursive: true });
  db = new Database(DB_PATH, { create: true });
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      generated_at TEXT NOT NULL UNIQUE,
      sound_latest_time TEXT,
      sound_level_ft REAL,
      marine_latest_time TEXT,
      wave_height_ft REAL,
      water_temp_f REAL,
      weather_temperature_f REAL,
      weather_summary TEXT,
      errors_json TEXT NOT NULL,
      sound_json TEXT,
      marine_json TEXT,
      weather_json TEXT,
      snapshot_json TEXT
    );

    CREATE TABLE IF NOT EXISTS sound_levels (
      site TEXT NOT NULL,
      time TEXT NOT NULL,
      value_ft REAL NOT NULL,
      source TEXT NOT NULL,
      fetched_at TEXT NOT NULL,
      raw_json TEXT NOT NULL,
      PRIMARY KEY (site, time)
    );

    CREATE INDEX IF NOT EXISTS idx_sound_levels_time
      ON sound_levels (time DESC);

    CREATE TABLE IF NOT EXISTS marine_observations (
      station TEXT NOT NULL,
      time TEXT NOT NULL,
      wind_direction_deg REAL,
      wind_speed_mps REAL,
      wind_gust_mps REAL,
      wave_height_ft REAL,
      dominant_period_sec REAL,
      average_period_sec REAL,
      mean_wave_direction_deg REAL,
      mean_wave_direction_text TEXT,
      pressure_hpa REAL,
      air_temp_f REAL,
      water_temp_f REAL,
      dew_point_f REAL,
      visibility_nmi REAL,
      pressure_tendency_hpa REAL,
      tide_ft REAL,
      source TEXT NOT NULL,
      fetched_at TEXT NOT NULL,
      raw_json TEXT NOT NULL,
      PRIMARY KEY (station, time)
    );

    CREATE INDEX IF NOT EXISTS idx_marine_observations_time
      ON marine_observations (time DESC);

    CREATE TABLE IF NOT EXISTS marine_spectral (
      station TEXT NOT NULL,
      time TEXT NOT NULL,
      wave_height_ft REAL,
      swell_height_ft REAL,
      swell_period_sec REAL,
      wind_wave_height_ft REAL,
      wind_wave_period_sec REAL,
      swell_direction TEXT,
      wind_wave_direction TEXT,
      steepness TEXT,
      average_period_sec REAL,
      mean_wave_direction_deg REAL,
      source TEXT NOT NULL,
      fetched_at TEXT NOT NULL,
      raw_json TEXT NOT NULL,
      PRIMARY KEY (station, time)
    );

    CREATE INDEX IF NOT EXISTS idx_marine_spectral_time
      ON marine_spectral (time DESC);

    CREATE TABLE IF NOT EXISTS weather_observations (
      station TEXT NOT NULL,
      time TEXT NOT NULL,
      source TEXT NOT NULL,
      temperature_f REAL,
      humidity REAL,
      pressure_in_hg REAL,
      wind TEXT,
      precip_chance REAL,
      summary TEXT,
      note TEXT,
      raw_json TEXT NOT NULL,
      PRIMARY KEY (station, time)
    );

    CREATE INDEX IF NOT EXISTS idx_weather_observations_time
      ON weather_observations (time DESC);

    CREATE TABLE IF NOT EXISTS buoy_observations (
      station_id TEXT NOT NULL,
      station_name TEXT NOT NULL,
      zone TEXT NOT NULL,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      distance_from_va_nc_line_miles REAL,
      time TEXT NOT NULL,
      wave_height_ft REAL,
      dominant_period_sec REAL,
      average_period_sec REAL,
      mean_wave_direction_deg REAL,
      mean_wave_direction_text TEXT,
      wind_direction_deg REAL,
      wind_speed_mps REAL,
      wind_gust_mps REAL,
      pressure_hpa REAL,
      air_temp_f REAL,
      water_temp_f REAL,
      dew_point_f REAL,
      visibility_nmi REAL,
      pressure_tendency_hpa REAL,
      tide_ft REAL,
      source TEXT NOT NULL,
      fetched_at TEXT NOT NULL,
      is_stale INTEGER NOT NULL DEFAULT 0,
      raw_json TEXT NOT NULL,
      PRIMARY KEY (station_id, time)
    );

    CREATE INDEX IF NOT EXISTS idx_buoy_observations_time
      ON buoy_observations (time DESC);

    CREATE INDEX IF NOT EXISTS idx_buoy_observations_station_time
      ON buoy_observations (station_id, time DESC);

    CREATE TABLE IF NOT EXISTS tide_predictions (
      station_id TEXT NOT NULL,
      station_name TEXT NOT NULL,
      reference_name TEXT NOT NULL,
      distance_from_reference_miles REAL,
      time TEXT NOT NULL,
      local_time TEXT NOT NULL,
      tide_type TEXT NOT NULL,
      value_ft REAL,
      datum TEXT NOT NULL,
      source TEXT NOT NULL,
      fetched_at TEXT NOT NULL,
      raw_json TEXT NOT NULL,
      PRIMARY KEY (station_id, time, tide_type)
    );

    CREATE INDEX IF NOT EXISTS idx_tide_predictions_time
      ON tide_predictions (time DESC);
  `);

  ensureColumn(db, "snapshots", "snapshot_json", "TEXT");
  ensureColumn(db, "marine_observations", "dew_point_f", "REAL");
  ensureColumn(db, "marine_observations", "visibility_nmi", "REAL");
  ensureColumn(db, "marine_observations", "pressure_tendency_hpa", "REAL");
  ensureColumn(db, "marine_observations", "tide_ft", "REAL");
  ensureColumn(db, "buoy_observations", "wind_direction_deg", "REAL");
  ensureColumn(db, "buoy_observations", "wind_speed_mps", "REAL");
  ensureColumn(db, "buoy_observations", "wind_gust_mps", "REAL");
  ensureColumn(db, "buoy_observations", "pressure_hpa", "REAL");
  ensureColumn(db, "buoy_observations", "dew_point_f", "REAL");
  ensureColumn(db, "buoy_observations", "visibility_nmi", "REAL");
  ensureColumn(db, "buoy_observations", "pressure_tendency_hpa", "REAL");
  ensureColumn(db, "buoy_observations", "tide_ft", "REAL");

  return db;
}

function ensureColumn(db: Database, table: string, column: string, definition: string) {
  const columns = db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (columns.some((item) => item.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

export function persistSnapshot(snapshot: Snapshot) {
  const db = getDb();

  const insertSnapshot = db.prepare(`
    INSERT INTO snapshots (
      generated_at,
      sound_latest_time,
      sound_level_ft,
      marine_latest_time,
      wave_height_ft,
      water_temp_f,
      weather_temperature_f,
      weather_summary,
      errors_json,
      sound_json,
      marine_json,
      weather_json,
      snapshot_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(generated_at) DO UPDATE SET
      sound_latest_time = excluded.sound_latest_time,
      sound_level_ft = excluded.sound_level_ft,
      marine_latest_time = excluded.marine_latest_time,
      wave_height_ft = excluded.wave_height_ft,
      water_temp_f = excluded.water_temp_f,
      weather_temperature_f = excluded.weather_temperature_f,
      weather_summary = excluded.weather_summary,
      errors_json = excluded.errors_json,
      sound_json = excluded.sound_json,
      marine_json = excluded.marine_json,
      weather_json = excluded.weather_json,
      snapshot_json = excluded.snapshot_json
  `);

  const insertSound = db.prepare(`
    INSERT INTO sound_levels (site, time, value_ft, source, fetched_at, raw_json)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(site, time) DO UPDATE SET
      value_ft = excluded.value_ft,
      source = excluded.source,
      fetched_at = excluded.fetched_at,
      raw_json = excluded.raw_json
  `);

  const insertMarine = db.prepare(`
    INSERT INTO marine_observations (
      station,
      time,
      wind_direction_deg,
      wind_speed_mps,
      wind_gust_mps,
      wave_height_ft,
      dominant_period_sec,
      average_period_sec,
      mean_wave_direction_deg,
      mean_wave_direction_text,
      pressure_hpa,
      air_temp_f,
      water_temp_f,
      dew_point_f,
      visibility_nmi,
      pressure_tendency_hpa,
      tide_ft,
      source,
      fetched_at,
      raw_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(station, time) DO UPDATE SET
      wind_direction_deg = excluded.wind_direction_deg,
      wind_speed_mps = excluded.wind_speed_mps,
      wind_gust_mps = excluded.wind_gust_mps,
      wave_height_ft = excluded.wave_height_ft,
      dominant_period_sec = excluded.dominant_period_sec,
      average_period_sec = excluded.average_period_sec,
      mean_wave_direction_deg = excluded.mean_wave_direction_deg,
      mean_wave_direction_text = excluded.mean_wave_direction_text,
      pressure_hpa = excluded.pressure_hpa,
      air_temp_f = excluded.air_temp_f,
      water_temp_f = excluded.water_temp_f,
      dew_point_f = excluded.dew_point_f,
      visibility_nmi = excluded.visibility_nmi,
      pressure_tendency_hpa = excluded.pressure_tendency_hpa,
      tide_ft = excluded.tide_ft,
      source = excluded.source,
      fetched_at = excluded.fetched_at,
      raw_json = excluded.raw_json
  `);

  const insertSpectral = db.prepare(`
    INSERT INTO marine_spectral (
      station,
      time,
      wave_height_ft,
      swell_height_ft,
      swell_period_sec,
      wind_wave_height_ft,
      wind_wave_period_sec,
      swell_direction,
      wind_wave_direction,
      steepness,
      average_period_sec,
      mean_wave_direction_deg,
      source,
      fetched_at,
      raw_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(station, time) DO UPDATE SET
      wave_height_ft = excluded.wave_height_ft,
      swell_height_ft = excluded.swell_height_ft,
      swell_period_sec = excluded.swell_period_sec,
      wind_wave_height_ft = excluded.wind_wave_height_ft,
      wind_wave_period_sec = excluded.wind_wave_period_sec,
      swell_direction = excluded.swell_direction,
      wind_wave_direction = excluded.wind_wave_direction,
      steepness = excluded.steepness,
      average_period_sec = excluded.average_period_sec,
      mean_wave_direction_deg = excluded.mean_wave_direction_deg,
      source = excluded.source,
      fetched_at = excluded.fetched_at,
      raw_json = excluded.raw_json
  `);

  const insertWeather = db.prepare(`
    INSERT INTO weather_observations (
      station,
      time,
      source,
      temperature_f,
      humidity,
      pressure_in_hg,
      wind,
      precip_chance,
      summary,
      note,
      raw_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(station, time) DO UPDATE SET
      source = excluded.source,
      temperature_f = excluded.temperature_f,
      humidity = excluded.humidity,
      pressure_in_hg = excluded.pressure_in_hg,
      wind = excluded.wind,
      precip_chance = excluded.precip_chance,
      summary = excluded.summary,
      note = excluded.note,
      raw_json = excluded.raw_json
  `);

  const insertBuoy = db.prepare(`
    INSERT INTO buoy_observations (
      station_id,
      station_name,
      zone,
      latitude,
      longitude,
      distance_from_va_nc_line_miles,
      time,
      wave_height_ft,
      dominant_period_sec,
      average_period_sec,
      mean_wave_direction_deg,
      mean_wave_direction_text,
      wind_direction_deg,
      wind_speed_mps,
      wind_gust_mps,
      pressure_hpa,
      air_temp_f,
      water_temp_f,
      dew_point_f,
      visibility_nmi,
      pressure_tendency_hpa,
      tide_ft,
      source,
      fetched_at,
      is_stale,
      raw_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(station_id, time) DO UPDATE SET
      station_name = excluded.station_name,
      zone = excluded.zone,
      latitude = excluded.latitude,
      longitude = excluded.longitude,
      distance_from_va_nc_line_miles = excluded.distance_from_va_nc_line_miles,
      wave_height_ft = excluded.wave_height_ft,
      dominant_period_sec = excluded.dominant_period_sec,
      average_period_sec = excluded.average_period_sec,
      mean_wave_direction_deg = excluded.mean_wave_direction_deg,
      mean_wave_direction_text = excluded.mean_wave_direction_text,
      wind_direction_deg = excluded.wind_direction_deg,
      wind_speed_mps = excluded.wind_speed_mps,
      wind_gust_mps = excluded.wind_gust_mps,
      pressure_hpa = excluded.pressure_hpa,
      air_temp_f = excluded.air_temp_f,
      water_temp_f = excluded.water_temp_f,
      dew_point_f = excluded.dew_point_f,
      visibility_nmi = excluded.visibility_nmi,
      pressure_tendency_hpa = excluded.pressure_tendency_hpa,
      tide_ft = excluded.tide_ft,
      source = excluded.source,
      fetched_at = excluded.fetched_at,
      is_stale = excluded.is_stale,
      raw_json = excluded.raw_json
  `);

  const insertTide = db.prepare(`
    INSERT INTO tide_predictions (
      station_id,
      station_name,
      reference_name,
      distance_from_reference_miles,
      time,
      local_time,
      tide_type,
      value_ft,
      datum,
      source,
      fetched_at,
      raw_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(station_id, time, tide_type) DO UPDATE SET
      station_name = excluded.station_name,
      reference_name = excluded.reference_name,
      distance_from_reference_miles = excluded.distance_from_reference_miles,
      local_time = excluded.local_time,
      value_ft = excluded.value_ft,
      datum = excluded.datum,
      source = excluded.source,
      fetched_at = excluded.fetched_at,
      raw_json = excluded.raw_json
  `);
  const pruneSnapshots = db.prepare(`
    DELETE FROM snapshots
    WHERE generated_at < ?
      AND generated_at != (SELECT MAX(generated_at) FROM snapshots)
  `);

  const write = db.transaction(() => {
    insertSnapshot.run(
      snapshot.generatedAt,
      valueOrNull(snapshot.sound?.latest?.time),
      valueOrNull(snapshot.sound?.latest?.value),
      valueOrNull(snapshot.marine?.latest?.time),
      valueOrNull(snapshot.marine?.latest?.waveHeightFt),
      valueOrNull(snapshot.marine?.latest?.waterTempF),
      valueOrNull(snapshot.weather?.temperatureF),
      valueOrNull(snapshot.weather?.summary),
      toJson(snapshot.errors),
      compactJson(snapshot.sound),
      compactJson(snapshot.marine),
      toJson(snapshot.weather),
      toJson(compactSnapshot(snapshot))
    );

    for (const point of snapshot.sound?.history ?? snapshot.sound?.series ?? []) {
      if (!Number.isFinite(point.value)) continue;
      insertSound.run(
        snapshot.sound?.siteName ?? "CURRITUCK SOUND ON EAST BANK AT COROLLA, NC",
        point.time,
        point.value,
        snapshot.sound?.source ?? "",
        snapshot.generatedAt,
        toJson(point)
      );
    }

    for (const point of snapshot.marine?.history ?? snapshot.marine?.series ?? []) {
      insertMarine.run(
        snapshot.marine?.station ?? "44056 - Duck FRF, NC",
        point.time,
        valueOrNull(point.windDirectionDeg),
        valueOrNull(point.windSpeedMps),
        valueOrNull(point.windGustMps),
        valueOrNull(point.waveHeightFt),
        valueOrNull(point.dominantPeriodSec),
        valueOrNull(point.averagePeriodSec),
        valueOrNull(point.meanWaveDirectionDeg),
        valueOrNull(point.meanWaveDirectionText),
        valueOrNull(point.pressureHpa),
        valueOrNull(point.airTempF),
        valueOrNull(point.waterTempF),
        valueOrNull(point.dewPointF),
        valueOrNull(point.visibilityNmi),
        valueOrNull(point.pressureTendencyHpa),
        valueOrNull(point.tideFt),
        snapshot.marine?.source ?? "",
        snapshot.generatedAt,
        toJson(point)
      );
    }

    if (snapshot.marine?.spectral?.time) {
      const point = snapshot.marine.spectral;
      insertSpectral.run(
        snapshot.marine?.station ?? "44056 - Duck FRF, NC",
        point.time,
        valueOrNull(point.waveHeightFt),
        valueOrNull(point.swellHeightFt),
        valueOrNull(point.swellPeriodSec),
        valueOrNull(point.windWaveHeightFt),
        valueOrNull(point.windWavePeriodSec),
        valueOrNull(point.swellDirection),
        valueOrNull(point.windWaveDirection),
        valueOrNull(point.steepness),
        valueOrNull(point.averagePeriodSec),
        valueOrNull(point.meanWaveDirectionDeg),
        snapshot.marine?.source ?? "",
        snapshot.generatedAt,
        toJson(point)
      );
    }

    if (snapshot.weather) {
      insertWeather.run(
        snapshot.weather.station ?? "CCEM Carova Beach Fire Department",
        snapshot.generatedAt,
        snapshot.weather.source ?? "",
        valueOrNull(snapshot.weather.temperatureF),
        valueOrNull(snapshot.weather.humidity),
        valueOrNull(snapshot.weather.pressureInHg),
        valueOrNull(snapshot.weather.wind),
        valueOrNull(snapshot.weather.precipChance),
        valueOrNull(snapshot.weather.summary),
        valueOrNull(snapshot.weather.note),
        toJson(snapshot.weather)
      );
    }

    for (const station of snapshot.buoys?.stations ?? []) {
      const rows = station.history?.length ? station.history : station.latest ? [station.latest] : [];

      for (const point of rows) {
        if (!point?.time) continue;
        insertBuoy.run(
          station.id,
          station.name,
          station.zone,
          station.lat,
          station.lon,
          valueOrNull(station.distanceFromVaNcLineMiles),
          point.time,
          valueOrNull(point.waveHeightFt),
          valueOrNull(point.dominantPeriodSec),
          valueOrNull(point.averagePeriodSec),
          valueOrNull(point.meanWaveDirectionDeg),
          valueOrNull(point.meanWaveDirectionText),
          valueOrNull(point.windDirectionDeg),
          valueOrNull(point.windSpeedMps),
          valueOrNull(point.windGustMps),
          valueOrNull(point.pressureHpa),
          valueOrNull(point.airTempF),
          valueOrNull(point.waterTempF),
          valueOrNull(point.dewPointF),
          valueOrNull(point.visibilityNmi),
          valueOrNull(point.pressureTendencyHpa),
          valueOrNull(point.tideFt),
          station.source ?? "",
          snapshot.generatedAt,
          isOlderThan(snapshot.generatedAt, point.time, 24) ? 1 : 0,
          toJson(point)
        );
      }
    }

    for (const prediction of snapshot.tide?.predictions ?? []) {
      if (!prediction?.time) continue;
      insertTide.run(
        snapshot.tide.station?.id ?? "",
        snapshot.tide.station?.name ?? "",
        snapshot.tide.reference?.name ?? "",
        valueOrNull(snapshot.tide.distanceFromReferenceMiles ?? snapshot.tide.distanceFromCarovaMiles),
        prediction.time,
        prediction.localTime ?? "",
        prediction.type ?? "",
        valueOrNull(prediction.valueFt),
        snapshot.tide.station?.datum ?? "MLLW",
        snapshot.tide.source ?? "",
        snapshot.generatedAt,
        toJson(prediction)
      );
    }

    const retentionCutoff = new Date(
      new Date(snapshot.generatedAt).getTime() - SNAPSHOT_RETENTION_DAYS * 24 * 60 * 60 * 1000
    );
    if (Number.isFinite(retentionCutoff.getTime())) {
      pruneSnapshots.run(retentionCutoff.toISOString());
    }
  });

  write();
}

export function getCachedSnapshot(maxAgeMs: number) {
  const snapshot = getLatestSnapshot();
  if (!snapshot?.generatedAt) return undefined;

  const generatedAtMs = new Date(snapshot.generatedAt).getTime();
  if (!Number.isFinite(generatedAtMs) || Date.now() - generatedAtMs > maxAgeMs) return undefined;

  return snapshot;
}

export function getLatestSnapshot() {
  const db = getDb();
  const row = db.query(`
    SELECT snapshot_json AS snapshotJson
    FROM snapshots
    WHERE snapshot_json IS NOT NULL
    ORDER BY generated_at DESC
    LIMIT 1
  `).get() as { snapshotJson: string } | null;

  if (!row?.snapshotJson) return undefined;
  return JSON.parse(row.snapshotJson) as Snapshot;
}

export function getHistory(kind: string, limit = 250) {
  const db = getDb();
  const boundedLimit = normalizeHistoryLimit(limit);

  if (kind === "sound") {
    return db.query(`
      SELECT site, time, value_ft AS valueFt, source, fetched_at AS fetchedAt
      FROM sound_levels
      ORDER BY time DESC
      LIMIT ?
    `).all(boundedLimit);
  }

  if (kind === "marine") {
    return db.query(`
      SELECT
        station,
        time,
        wave_height_ft AS waveHeightFt,
        dominant_period_sec AS dominantPeriodSec,
        average_period_sec AS averagePeriodSec,
        mean_wave_direction_deg AS meanWaveDirectionDeg,
        mean_wave_direction_text AS meanWaveDirectionText,
        wind_direction_deg AS windDirectionDeg,
        wind_speed_mps AS windSpeedMps,
        wind_gust_mps AS windGustMps,
        pressure_hpa AS pressureHpa,
        air_temp_f AS airTempF,
        water_temp_f AS waterTempF,
        dew_point_f AS dewPointF,
        visibility_nmi AS visibilityNmi,
        pressure_tendency_hpa AS pressureTendencyHpa,
        tide_ft AS tideFt,
        source,
        fetched_at AS fetchedAt
      FROM marine_observations
      ORDER BY time DESC
      LIMIT ?
    `).all(boundedLimit);
  }

  if (kind === "spectral") {
    return db.query(`
      SELECT
        station,
        time,
        wave_height_ft AS waveHeightFt,
        swell_height_ft AS swellHeightFt,
        swell_period_sec AS swellPeriodSec,
        wind_wave_height_ft AS windWaveHeightFt,
        wind_wave_period_sec AS windWavePeriodSec,
        swell_direction AS swellDirection,
        wind_wave_direction AS windWaveDirection,
        steepness,
        source,
        fetched_at AS fetchedAt
      FROM marine_spectral
      ORDER BY time DESC
      LIMIT ?
    `).all(boundedLimit);
  }

  if (kind === "weather") {
    return db.query(`
      SELECT
        station,
        time,
        source,
        temperature_f AS temperatureF,
        humidity,
        pressure_in_hg AS pressureInHg,
        wind,
        precip_chance AS precipChance,
        summary,
        note
      FROM weather_observations
      ORDER BY time DESC
      LIMIT ?
    `).all(boundedLimit);
  }

  if (kind === "buoys") {
    return db.query(`
      SELECT
        station_id AS stationId,
        station_name AS stationName,
        zone,
        latitude AS lat,
        longitude AS lon,
        distance_from_va_nc_line_miles AS distanceFromVaNcLineMiles,
        time,
        wave_height_ft AS waveHeightFt,
        dominant_period_sec AS dominantPeriodSec,
        average_period_sec AS averagePeriodSec,
        mean_wave_direction_deg AS meanWaveDirectionDeg,
        mean_wave_direction_text AS meanWaveDirectionText,
        wind_direction_deg AS windDirectionDeg,
        wind_speed_mps AS windSpeedMps,
        wind_gust_mps AS windGustMps,
        pressure_hpa AS pressureHpa,
        air_temp_f AS airTempF,
        water_temp_f AS waterTempF,
        dew_point_f AS dewPointF,
        visibility_nmi AS visibilityNmi,
        pressure_tendency_hpa AS pressureTendencyHpa,
        tide_ft AS tideFt,
        source,
        fetched_at AS fetchedAt,
        is_stale AS isStale
      FROM buoy_observations
      ORDER BY time DESC
      LIMIT ?
    `).all(boundedLimit);
  }

  if (kind === "tides") {
    return db.query(`
      SELECT
        station_id AS stationId,
        station_name AS stationName,
        reference_name AS referenceName,
        distance_from_reference_miles AS distanceFromReferenceMiles,
        time,
        local_time AS localTime,
        tide_type AS type,
        value_ft AS valueFt,
        datum,
        source,
        fetched_at AS fetchedAt
      FROM tide_predictions
      ORDER BY time DESC
      LIMIT ?
    `).all(boundedLimit);
  }

  return db.query(`
    SELECT
      id,
      generated_at AS generatedAt,
      sound_latest_time AS soundLatestTime,
      sound_level_ft AS soundLevelFt,
      marine_latest_time AS marineLatestTime,
      wave_height_ft AS waveHeightFt,
      water_temp_f AS waterTempF,
      weather_temperature_f AS weatherTemperatureF,
      weather_summary AS weatherSummary,
      errors_json AS errorsJson
    FROM snapshots
    ORDER BY generated_at DESC
    LIMIT ?
  `).all(boundedLimit);
}

type BuoyTrendStation = {
  stationId: string;
  stationName: string;
  zone: string;
  lat: number;
  lon: number;
  distanceFromVaNcLineMiles?: number;
  latestTime?: string;
  latestWaterTempF?: number;
  latestAgeHours?: number;
  isStale: boolean;
  change24hF?: number;
  range7dF?: { min: number; max: number };
  series7d: Array<{ time: string; waterTempF: number }>;
};

function finiteOrUndefined(value: unknown) {
  if (value === null || value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function downsampleSeries<T>(items: T[], target = 48) {
  if (items.length <= target) return items;
  const result: T[] = [];
  const lastIndex = items.length - 1;
  for (let index = 0; index < target; index++) {
    result.push(items[Math.round((index / (target - 1)) * lastIndex)]);
  }
  return result;
}

function trendSummaryStation(station: BuoyTrendStation) {
  return {
    stationId: station.stationId,
    stationName: station.stationName,
    valueF: station.latestWaterTempF,
    change24hF: station.change24hF
  };
}

export function getBuoyTrends() {
  const db = getDb();
  const rows = db.query(`
    SELECT
      station_id AS stationId,
      station_name AS stationName,
      zone,
      latitude AS lat,
      longitude AS lon,
      distance_from_va_nc_line_miles AS distanceFromVaNcLineMiles,
      time,
      water_temp_f AS waterTempF,
      fetched_at AS fetchedAt,
      is_stale AS isStale
    FROM buoy_observations
    WHERE water_temp_f IS NOT NULL
    ORDER BY station_id ASC, time DESC
  `).all() as Array<{
    stationId: string;
    stationName: string;
    zone: string;
    lat: number;
    lon: number;
    distanceFromVaNcLineMiles: number | null;
    time: string;
    waterTempF: number | null;
    fetchedAt: string;
    isStale: number;
  }>;

  const grouped = new Map<string, typeof rows>();
  for (const row of rows) {
    const bucket = grouped.get(row.stationId) ?? [];
    bucket.push(row);
    grouped.set(row.stationId, bucket);
  }

  const stations: BuoyTrendStation[] = Array.from(grouped.values()).map((stationRows) => {
    const latest = stationRows[0];
    const latestTimeMs = new Date(latest.time).getTime();
    const latestTemp = finiteOrUndefined(latest.waterTempF);
    const target24hMs = latestTimeMs - 24 * 60 * 60 * 1000;
    const sevenDayMs = latestTimeMs - 7 * 24 * 60 * 60 * 1000;
    const prior24h = stationRows.find((row) => new Date(row.time).getTime() <= target24hMs);
    const priorTemp = finiteOrUndefined(prior24h?.waterTempF);
    const series7d = stationRows
      .filter((row) => {
        const timeMs = new Date(row.time).getTime();
        return Number.isFinite(timeMs) && timeMs >= sevenDayMs && Number.isFinite(row.waterTempF);
      })
      .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime())
      .map((row) => ({ time: row.time, waterTempF: Number(row.waterTempF) }));
    const values7d = series7d.map((point) => point.waterTempF).filter(Number.isFinite);
    const latestTimeAgeHours = Number.isFinite(latestTimeMs)
      ? (Date.now() - latestTimeMs) / (60 * 60 * 1000)
      : undefined;

    return {
      stationId: latest.stationId,
      stationName: latest.stationName,
      zone: latest.zone,
      lat: latest.lat,
      lon: latest.lon,
      distanceFromVaNcLineMiles: finiteOrUndefined(latest.distanceFromVaNcLineMiles),
      latestTime: latest.time,
      latestWaterTempF: latestTemp,
      latestAgeHours: latestTimeAgeHours,
      isStale: Boolean(latest.isStale),
      change24hF: Number.isFinite(latestTemp) && Number.isFinite(priorTemp)
        ? Number((latestTemp! - priorTemp!).toFixed(1))
        : undefined,
      range7dF: values7d.length
        ? { min: Math.min(...values7d), max: Math.max(...values7d) }
        : undefined,
      series7d: downsampleSeries(series7d, 48)
    };
  });

  const freshStations = stations.filter((station) => !station.isStale && Number.isFinite(station.latestWaterTempF));
  const trendStations = freshStations.filter((station) => Number.isFinite(station.change24hF));
  const warmestFresh = [...freshStations].sort((a, b) => (b.latestWaterTempF ?? -Infinity) - (a.latestWaterTempF ?? -Infinity))[0];
  const biggestRiseFresh = trendStations
    .filter((station) => (station.change24hF ?? 0) > 0)
    .sort((a, b) => (b.change24hF ?? -Infinity) - (a.change24hF ?? -Infinity))[0];
  const biggestDropFresh = trendStations
    .filter((station) => (station.change24hF ?? 0) < 0)
    .sort((a, b) => (a.change24hF ?? Infinity) - (b.change24hF ?? Infinity))[0];

  return {
    generatedAt: new Date().toISOString(),
    stations,
    summary: {
      freshStationCount: freshStations.length,
      warmestFresh: warmestFresh ? trendSummaryStation(warmestFresh) : undefined,
      biggestRiseFresh: biggestRiseFresh ? trendSummaryStation(biggestRiseFresh) : undefined,
      biggestDropFresh: biggestDropFresh ? trendSummaryStation(biggestDropFresh) : undefined
    }
  };
}

export function getDatabaseStats() {
  const db = getDb();

  return {
    path: DB_PATH,
    snapshots: db.query("SELECT COUNT(*) AS count FROM snapshots").get(),
    soundLevels: db.query("SELECT COUNT(*) AS count FROM sound_levels").get(),
    marineObservations: db.query("SELECT COUNT(*) AS count FROM marine_observations").get(),
    marineSpectral: db.query("SELECT COUNT(*) AS count FROM marine_spectral").get(),
    weatherObservations: db.query("SELECT COUNT(*) AS count FROM weather_observations").get(),
    buoyObservations: db.query("SELECT COUNT(*) AS count FROM buoy_observations").get(),
    tidePredictions: db.query("SELECT COUNT(*) AS count FROM tide_predictions").get()
  };
}
