export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

export type LogFields = Record<string, unknown>;

export type LogEntry = {
  ts: string;
  level: LogLevel;
  service: string;
  env: string;
  msg: string;
  [key: string]: unknown;
};

function parseLogLevel(value: string | undefined, fallback: LogLevel): LogLevel {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "debug" || normalized === "info" || normalized === "warn" || normalized === "error") {
    return normalized;
  }
  return fallback;
}

function defaultLogLevel(): LogLevel {
  return Bun.env.NODE_ENV === "production" ? "info" : "debug";
}

const configuredLevel = parseLogLevel(Bun.env.LOG_LEVEL, defaultLogLevel());
const serviceName = Bun.env.SERVICE_NAME?.trim() || "obx-conditions";
const environment = Bun.env.NODE_ENV?.trim() || "development";
const logFormat = Bun.env.LOG_FORMAT?.trim().toLowerCase() === "pretty" ? "pretty" : "json";

function shouldLog(level: LogLevel) {
  return LEVEL_RANK[level] >= LEVEL_RANK[configuredLevel];
}

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return {
      error: error.message,
      errorName: error.name,
      stack: error.stack
    };
  }
  return { error: String(error) };
}

function write(level: LogLevel, msg: string, fields: LogFields = {}) {
  if (!shouldLog(level)) return;

  const entry: LogEntry = {
    ts: new Date().toISOString(),
    level,
    service: serviceName,
    env: environment,
    msg,
    ...fields
  };

  if (logFormat === "pretty") {
    const suffix = Object.keys(fields).length
      ? ` ${JSON.stringify(fields)}`
      : "";
    const line = `${entry.ts} ${level.toUpperCase().padEnd(5)} ${msg}${suffix}`;
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
    return;
  }

  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export const logger = {
  level: configuredLevel,
  service: serviceName,
  debug: (msg: string, fields?: LogFields) => write("debug", msg, fields),
  info: (msg: string, fields?: LogFields) => write("info", msg, fields),
  warn: (msg: string, fields?: LogFields) => write("warn", msg, fields),
  error: (msg: string, fields?: LogFields) => write("error", msg, fields),
  with(fields: LogFields) {
    return {
      debug: (msg: string, extra?: LogFields) => write("debug", msg, { ...fields, ...extra }),
      info: (msg: string, extra?: LogFields) => write("info", msg, { ...fields, ...extra }),
      warn: (msg: string, extra?: LogFields) => write("warn", msg, { ...fields, ...extra }),
      error: (msg: string, extra?: LogFields) => write("error", msg, { ...fields, ...extra })
    };
  },
  child(fields: LogFields) {
    return this.with(fields);
  },
  logHttp(request: Request, response: Response, durationMs: number, extra: LogFields = {}) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const isApi = pathname.startsWith("/api/");
    const isAsset = !isApi && pathname !== "/" && response.status !== 404;
    const level: LogLevel = response.status >= 500
      ? "error"
      : response.status >= 400
        ? "warn"
        : "info";

    if (isAsset && level === "info" && configuredLevel !== "debug") {
      return;
    }

    write(level, "http_request", {
      event: "http_request",
      method: request.method,
      path: pathname,
      route: isApi ? pathname : isAsset ? "static" : pathname === "/" ? "index" : "other",
      status: response.status,
      durationMs: Math.max(0, Math.round(durationMs)),
      userAgent: request.headers.get("user-agent") || undefined,
      ...extra
    });
  },
  logFeedErrors(errors: Record<string, string | undefined>, extra: LogFields = {}) {
    for (const [source, message] of Object.entries(errors)) {
      if (!message) continue;
      write("warn", "feed_failed", {
        event: "feed_failed",
        source,
        message,
        ...extra
      });
    }
  },
  logSnapshot(event: string, fields: LogFields = {}) {
    write(fields.level === "error" ? "error" : "info", event, {
      event,
      component: "snapshot",
      ...fields
    });
  }
};

export function createRequestLogger(request: Request) {
  const url = new URL(request.url);
  return logger.child({
    method: request.method,
    path: url.pathname
  });
}