import { describe, expect, test } from "bun:test";

import { normalizeHistoryLimit } from "../src/db";

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
