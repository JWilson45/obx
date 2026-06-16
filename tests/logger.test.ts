import { afterEach, describe, expect, test } from "bun:test";

const originalEnv = { ...Bun.env };
const originalLog = console.log;
const originalWarn = console.warn;
const originalError = console.error;

function restoreEnv() {
  for (const key of Object.keys(Bun.env)) {
    if (!(key in originalEnv)) delete Bun.env[key];
  }
  Object.assign(Bun.env, originalEnv);
}

function captureConsole() {
  const lines: string[] = [];
  const write = (line: string) => lines.push(line);
  console.log = write;
  console.warn = write;
  console.error = write;
  return lines;
}

function restoreConsole() {
  console.log = originalLog;
  console.warn = originalWarn;
  console.error = originalError;
}

async function loadLogger(env: Record<string, string | undefined> = {}) {
  restoreEnv();
  Object.assign(Bun.env, env);
  return import(`../src/logger.ts?test=${Date.now()}-${Math.random()}`);
}

afterEach(() => {
  restoreEnv();
  restoreConsole();
});

describe("logger", () => {
  test("writes JSON logs with Loki-friendly fields", async () => {
    const lines = captureConsole();
    const { logger } = await loadLogger({
      LOG_LEVEL: "info",
      LOG_FORMAT: "json",
      SERVICE_NAME: "obx-test",
      NODE_ENV: "test"
    });

    logger.info("server_started", { port: 3000 });

    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]!);
    expect(entry.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(entry.level).toBe("info");
    expect(entry.service).toBe("obx-test");
    expect(entry.env).toBe("test");
    expect(entry.msg).toBe("server_started");
    expect(entry.port).toBe(3000);
  });

  test("respects LOG_LEVEL", async () => {
    const lines = captureConsole();
    const { logger } = await loadLogger({
      LOG_LEVEL: "warn",
      LOG_FORMAT: "json"
    });

    logger.debug("hidden");
    logger.info("hidden");
    logger.warn("visible");
    logger.error("visible");

    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!).level).toBe("warn");
    expect(JSON.parse(lines[1]!).level).toBe("error");
  });

  test("logs HTTP requests with route metadata", async () => {
    const lines = captureConsole();
    const { logger } = await loadLogger({
      LOG_LEVEL: "info",
      LOG_FORMAT: "json"
    });

    const request = new Request("http://localhost:3000/api/snapshot");
    logger.logHttp(request, new Response("{}", { status: 200 }), 42);

    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]!);
    expect(entry.msg).toBe("http_request");
    expect(entry.event).toBe("http_request");
    expect(entry.method).toBe("GET");
    expect(entry.path).toBe("/api/snapshot");
    expect(entry.route).toBe("/api/snapshot");
    expect(entry.status).toBe(200);
    expect(entry.durationMs).toBe(42);
  });

  test("logs feed failures with source and message fields", async () => {
    const lines = captureConsole();
    const { logger } = await loadLogger({
      LOG_LEVEL: "warn",
      LOG_FORMAT: "json"
    });

    logger.logFeedErrors({
      ndbc: "Upstream timeout",
      nws: undefined
    }, { phase: "snapshot_refresh" });

    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]!);
    expect(entry.msg).toBe("feed_failed");
    expect(entry.event).toBe("feed_failed");
    expect(entry.source).toBe("ndbc");
    expect(entry.message).toBe("Upstream timeout");
    expect(entry.phase).toBe("snapshot_refresh");
    expect(entry.error).toBeUndefined();
  });

  test("skips successful static asset logs unless debug", async () => {
    const lines = captureConsole();
    const { logger } = await loadLogger({
      LOG_LEVEL: "info",
      LOG_FORMAT: "json"
    });

    const request = new Request("http://localhost:3000/app.js");
    logger.logHttp(request, new Response("ok", { status: 200 }), 3);

    expect(lines).toHaveLength(0);
  });
});