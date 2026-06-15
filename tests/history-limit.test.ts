import { describe, expect, test } from "bun:test";

Bun.env.DB_PATH = `/private/tmp/obx-conditions-test-${process.pid}.sqlite`;

const { getBuoyTrends, getCachedSnapshot, getDatabaseStats, getHistory, normalizeHistoryLimit, persistSnapshot } = await import("../src/db");

describe("normalizeHistoryLimit", () => {
  test("falls back when the limit is not numeric", () => {
    expect(normalizeHistoryLimit(Number.NaN)).toBe(250);
  });

  test("clamps to the supported query range", () => {
    expect(normalizeHistoryLimit(-10)).toBe(1);
    expect(normalizeHistoryLimit(2500)).toBe(2000);
  });

  test("truncates fractional limits before querying SQLite", () => {
    expect(normalizeHistoryLimit(12.9)).toBe(12);
  });
});

describe("getCachedSnapshot", () => {
  test("returns a compact persisted snapshot within the cache window", () => {
    const snapshot = {
      generatedAt: new Date().toISOString(),
      sound: {
        latest: { time: "2026-05-04T12:00:00.000Z", value: 1.2 },
        history: [
          { time: "2026-05-04T11:00:00.000Z", value: 1.1 },
          { time: "2026-05-04T12:00:00.000Z", value: 1.2 }
        ],
        series: [{ time: "2026-05-04T12:00:00.000Z", value: 1.2 }],
        source: "test"
      },
      marine: {
        latest: { time: "2026-05-04T12:00:00.000Z", waveHeightFt: 2.4 },
        history: [{ time: "2026-05-04T12:00:00.000Z", waveHeightFt: 2.4 }],
        series: [{ time: "2026-05-04T12:00:00.000Z", waveHeightFt: 2.4 }],
        source: "test"
      },
      buoys: {
        stations: [{
          id: "44056",
          name: "Duck FRF",
          zone: "near-border",
          lat: 36.2,
          lon: -75.714,
          latest: { time: "2026-05-04T12:00:00.000Z", waterTempF: 62 },
          history: [{ time: "2026-05-04T12:00:00.000Z", waterTempF: 62 }],
          source: "test"
        }]
      },
      weather: { temperatureF: 70, summary: "Clear" },
      tide: {
        station: { id: "8639428", name: "Sandbridge, VA", datum: "MLLW" },
        reference: { name: "VA/NC line oceanfront" },
        predictions: [{ time: "2026-05-04T12:00:00.000Z", type: "High", valueFt: 3.1 }]
      },
      errors: {}
    };

    persistSnapshot(snapshot);

    const cached = getCachedSnapshot(60_000);

    expect(cached?.generatedAt).toBe(snapshot.generatedAt);
    expect(cached?.sound?.latest?.value).toBe(1.2);
    expect(cached?.sound?.history).toBeUndefined();
    expect(cached?.marine?.history).toBeUndefined();
    expect(cached?.buoys?.stations?.[0]?.history).toBeUndefined();
    expect(cached?.tide?.station?.id).toBe("8639428");
  });
});

describe("snapshot retention", () => {
  test("prunes old dashboard snapshots without deleting normalized history", () => {
    const oldSnapshot = {
      generatedAt: "2026-04-01T12:00:00.000Z",
      sound: {
        latest: { time: "2026-04-01T12:00:00.000Z", value: 1.1 },
        history: [{ time: "2026-04-01T12:00:00.000Z", value: 1.1 }],
        source: "test"
      },
      errors: {}
    };
    const currentSnapshot = {
      generatedAt: "2026-05-04T12:00:00.000Z",
      sound: {
        latest: { time: "2026-05-04T12:00:00.000Z", value: 1.2 },
        history: [{ time: "2026-05-04T12:00:00.000Z", value: 1.2 }],
        source: "test"
      },
      errors: {}
    };

    persistSnapshot(oldSnapshot);
    persistSnapshot(currentSnapshot);

    expect(getDatabaseStats().snapshots).toEqual({ count: 2 });
    const snapshots = getHistory("snapshots", 10).map((row: any) => row.generatedAt);
    expect(snapshots).toContain(currentSnapshot.generatedAt);
    expect(snapshots).not.toContain(oldSnapshot.generatedAt);
    expect(getHistory("sound", 10).map((row: any) => row.time)).toContain(oldSnapshot.sound.latest.time);
  });
});

describe("getBuoyTrends", () => {
  test("computes 24 hour movement and excludes stale stations from movement summaries", () => {
    persistSnapshot({
      generatedAt: "2026-06-01T12:00:00.000Z",
      buoys: {
        stations: [
          {
            id: "TST_RISE",
            name: "Rising Test Buoy",
            zone: "near-border",
            lat: 36.2,
            lon: -75.7,
            distanceFromVaNcLineMiles: 3,
            latest: { time: "2026-06-01T12:00:00.000Z", waterTempF: 63.5, waveHeightFt: 2 },
            history: [
              { time: "2026-05-31T12:00:00.000Z", waterTempF: 60, waveHeightFt: 2 },
              { time: "2026-06-01T00:00:00.000Z", waterTempF: 61.5, waveHeightFt: 2 },
              { time: "2026-06-01T12:00:00.000Z", waterTempF: 63.5, waveHeightFt: 2 }
            ],
            source: "test"
          },
          {
            id: "TST_DROP",
            name: "Cooling Test Buoy",
            zone: "offshore",
            lat: 36.1,
            lon: -75.2,
            distanceFromVaNcLineMiles: 40,
            latest: { time: "2026-06-01T12:00:00.000Z", waterTempF: 65 },
            history: [
              { time: "2026-05-31T12:00:00.000Z", waterTempF: 69 },
              { time: "2026-06-01T12:00:00.000Z", waterTempF: 65 }
            ],
            source: "test"
          },
          {
            id: "TST_STALE",
            name: "Stale Rising Test Buoy",
            zone: "offshore",
            lat: 36,
            lon: -75,
            distanceFromVaNcLineMiles: 45,
            latest: { time: "2026-05-31T00:00:00.000Z", waterTempF: 72 },
            history: [
              { time: "2026-05-30T00:00:00.000Z", waterTempF: 62 },
              { time: "2026-05-31T00:00:00.000Z", waterTempF: 72 }
            ],
            source: "test"
          },
          {
            id: "TST_MISSING",
            name: "Missing History Test Buoy",
            zone: "northern",
            lat: 36.4,
            lon: -75.8,
            distanceFromVaNcLineMiles: 10,
            latest: { time: "2026-06-01T12:00:00.000Z", waterTempF: 66 },
            history: [{ time: "2026-06-01T12:00:00.000Z", waterTempF: 66 }],
            source: "test"
          }
        ]
      },
      errors: {}
    });

    const trends = getBuoyTrends();
    const rising = trends.stations.find((station: any) => station.stationId === "TST_RISE");
    const cooling = trends.stations.find((station: any) => station.stationId === "TST_DROP");
    const stale = trends.stations.find((station: any) => station.stationId === "TST_STALE");
    const missing = trends.stations.find((station: any) => station.stationId === "TST_MISSING");

    expect(rising?.change24hF).toBe(3.5);
    expect(rising?.range7dF).toEqual({ min: 60, max: 63.5 });
    expect(rising?.series7d).toHaveLength(3);
    expect(cooling?.change24hF).toBe(-4);
    expect(stale?.change24hF).toBe(10);
    expect(stale?.isStale).toBe(true);
    expect(missing?.change24hF).toBeUndefined();
    expect(trends.summary.biggestRiseFresh?.stationId).toBe("TST_RISE");
    expect(trends.summary.biggestDropFresh?.stationId).toBe("TST_DROP");
  });
});
