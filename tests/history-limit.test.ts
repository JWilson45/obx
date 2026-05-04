import { describe, expect, test } from "bun:test";

Bun.env.DB_PATH = `/private/tmp/obx-conditions-test-${process.pid}.sqlite`;

const { getCachedSnapshot, normalizeHistoryLimit, persistSnapshot } = await import("../src/db");

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
