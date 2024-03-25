import pinoHttp from "pino-http";
import * as Sentry from "@sentry/node";
import { Request } from "express";
import { BaseLogger, Level } from "pino";
import { AuthRequest } from "@back-end/src/types/AuthRequest";
import { ApiRequestLocals } from "@back-end/types/api";
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
];
if (!IS_CLOUD) {
  redactPaths.push(
    'req.headers["if-none-match"]',
    'req.headers["cache-control"]',
    "res.headers.etag"
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
  return ([
    "fatal",
    "error",
    "warn",
    "info",
    "debug",
    "trace",
  ] as const).includes(input as Level);
};

export const httpLogger = pinoHttp({
  autoLogging: ENVIRONMENT === "production",
  level: isValidLevel(LOG_LEVEL) ? LOG_LEVEL : "info",
  redact: {
    paths: redactPaths,
    remove: true,
  },
  customProps: getCustomLogProps,
});

/**
 * Wrapper for our logger
 */
export const logger: BaseLogger = {
  debug(...args: Parameters<BaseLogger["debug"]>) {
    httpLogger.logger.debug(...args);
  },
  error(...args: Parameters<BaseLogger["error"]>) {
    httpLogger.logger.error(...args);
    Sentry.captureException(...args);
  },
  fatal(...args: Parameters<BaseLogger["fatal"]>) {
    Sentry.captureException(...args);
    httpLogger.logger.fatal(...args);
  },
  info(...args: Parameters<BaseLogger["info"]>) {
    httpLogger.logger.info(...args);
  },
  level: httpLogger.logger.level,
  silent(...args: Parameters<BaseLogger["silent"]>) {
    httpLogger.logger.silent(...args);
  },
  trace(...args: Parameters<BaseLogger["trace"]>) {
    httpLogger.logger.trace(...args);
  },
  warn(...args: Parameters<BaseLogger["warn"]>) {
    httpLogger.logger.warn(...args);
  },
};
