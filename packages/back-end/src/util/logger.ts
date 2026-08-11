import { format } from "util";
import pinoHttp from "pino-http";
import * as Sentry from "@sentry/node";
import { Request } from "express";
import { BaseLogger, Level } from "pino";
import {
  ErrorWrapper,
  parseProcessLogBase,
  stringToBoolean,
} from "shared/util";
import { ApiRequestLocals } from "back-end/types/api";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { ENVIRONMENT, IS_CLOUD, LOG_LEVEL } from "./secrets";

const redactPaths = [
  "req.headers.authorization",
  'req.headers["upgrade-insecure-requests"]',
  "req.headers.cookie",
  "req.headers.connection",
  'req.headers["accept"]',
  'req.headers["accept-encoding"]',
  'req.headers["accept-language"]',
  'req.headers["sec-fetch-site"]',
  'req.headers["sec-fetch-mode"]',
  'req.headers["sec-fetch-dest"]',
  'req.headers["sec-ch-ua-mobile"]',
  'req.headers["sec-ch-ua"]',
  'req.headers["sec-fetch-user"]',
  'res.headers["x-powered-by"]',
  'res.headers["access-control-allow-credentials"]',
  'res.headers["access-control-allow-origin"]',
  'res.headers["set-cookie"]',
  'res.headers["cookie"]',
];
if (!IS_CLOUD) {
  redactPaths.push(
    'req.headers["if-none-match"]',
    'req.headers["cache-control"]',
    "res.headers.etag",
  );
}

// Request logging
export function getCustomLogProps(req: Request) {
  const typedReq = req as AuthRequest & ApiRequestLocals;

  // Add helpful fields to logs
  const data: { [key: string]: object | string | number | boolean } = {};
  if (typedReq.organization) {
    data.organization = {
      id: typedReq.organization.id,
      name: typedReq.organization.name,
    };
  }
  if (typedReq.apiKey) {
    data.apiKey = typedReq.apiKey;
  }
  if (typedReq.userId) {
    data.userId = typedReq.userId;
  }
  if (typedReq.superAdmin) {
    data.superAdmin = true;
  }
  return data;
}

const isValidLevel = (input: unknown): input is Level => {
  return (
    ["fatal", "error", "warn", "info", "debug", "trace"] as const
  ).includes(input as Level);
};

const logBase = parseProcessLogBase();

export const httpLogger = pinoHttp({
  autoLogging: ENVIRONMENT === "production",
  level: isValidLevel(LOG_LEVEL) ? LOG_LEVEL : "info",
  redact: {
    paths: redactPaths,
    remove: true,
  },
  customProps: getCustomLogProps,
  customReceivedMessage: stringToBoolean(process.env.LOG_REQUEST_STARTED)
    ? () => "Request started"
    : undefined,
  ...logBase,
});

export type BackendErrorTrackingHandler = (
  error: unknown,
  extra?: Record<string, unknown>,
) => void;

let errorTrackingHandler: BackendErrorTrackingHandler | null = null;

/**
 * Registered once at startup (see services/growthbook.ts) so that every
 * logger.error/fatal call also reports to GrowthBook error tracking,
 * mirroring what we already send to Sentry via reportLoggedError below.
 */
export function setErrorTrackingHandler(
  handler: BackendErrorTrackingHandler,
): void {
  errorTrackingHandler = handler;
}

/**
 * Wrapper for our logger
 */
export const logger: BaseLogger = {
  debug: (...args: unknown[]) => {
    httpLogger.logger.debug(...(args as Parameters<BaseLogger["debug"]>));
  },
  error: (...args: unknown[]) => {
    httpLogger.logger.error(...(args as Parameters<BaseLogger["error"]>));
    reportLoggedError(...(args as Parameters<BaseLogger["error"]>));
  },
  fatal: (...args: unknown[]) => {
    httpLogger.logger.fatal(...(args as Parameters<BaseLogger["fatal"]>));
    reportLoggedError(...(args as Parameters<BaseLogger["fatal"]>));
  },
  info: (...args: unknown[]) => {
    httpLogger.logger.info(...(args as Parameters<BaseLogger["info"]>));
  },
  level: httpLogger.logger.level,
  silent: (...args: unknown[]) => {
    httpLogger.logger.silent(...(args as Parameters<BaseLogger["silent"]>));
  },
  trace: (...args: unknown[]) => {
    httpLogger.logger.trace(...(args as Parameters<BaseLogger["trace"]>));
  },
  warn: (...args: unknown[]) => {
    httpLogger.logger.warn(...(args as Parameters<BaseLogger["warn"]>));
  },
};

/** Resolves a Pino-style error log call into a normalized Error + extra fields. */
function resolveLoggedError(
  ...args: Parameters<BaseLogger["error" | "fatal"]>
): { error: Error; extras?: Record<string, unknown> } {
  // Ideally Pino typing would be better, but it's not
  const [obj, message, ...rest] = args as [
    string | Error | { err?: Error; [key: string]: unknown },
    string | unknown,
    ...unknown[],
  ];

  if (typeof obj === "string") {
    const msg = format(obj, message, ...rest);
    return { error: new Error(msg) };
  }

  if (obj instanceof Error) {
    const msg = format(message, ...rest);
    const error = msg
      ? new ErrorWrapper(msg, {
          message: obj.message,
          stack: obj.stack,
        })
      : obj;
    return { error };
  }

  const msg = format(message, ...rest);
  let error: Error;
  if (obj.err) {
    error = msg
      ? new ErrorWrapper(msg, {
          message: obj.err.message,
          stack: obj.err.stack,
        })
      : obj.err;
  } else {
    error = new Error(msg);
  }

  const extras = { ...(obj as Record<string, unknown>) };
  delete extras.err; // Do not double log the error
  return { error, extras };
}

function reportLoggedError(...args: Parameters<BaseLogger["error" | "fatal"]>) {
  const { error, extras } = resolveLoggedError(...args);

  Sentry.withScope((scope) => {
    if (extras) {
      scope.setExtras(extras);
    }
    Sentry.captureException(error);
  });

  errorTrackingHandler?.(error, extras);
}
