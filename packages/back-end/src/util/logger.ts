import pinoHttp from "pino-http";
import * as Sentry from "@sentry/node";
import { Request } from "express";
import { BaseLogger } from "pino";
import { ApiRequestLocals } from "../../types/api";
import { AuthRequest } from "../types/AuthRequest";
import { ENVIRONMENT } from "./secrets";

// Request logging
export function getCustomLogProps(req: Request) {
  const typedReq = req as AuthRequest & ApiRequestLocals;

  // Add helpful fields to logs
  const data: { [key: string]: string | number | boolean } = {};
  if (typedReq.organization) {
    data.organization = typedReq.organization.id;
    data.orgName = typedReq.organization.name;
  }
  if (typedReq.apiKey) {
    data.apiKey = typedReq.apiKey;
  }
  if (typedReq.userId) {
    data.userId = typedReq.userId;
  }
  if (typedReq.admin) {
    data.admin = true;
  }
  return data;
}
export const httpLogger = pinoHttp({
  autoLogging: ENVIRONMENT === "production",
  redact: {
    paths: [
      "req.headers.authorization",
      'req.headers["if-none-match"]',
      'req.headers["cache-control"]',
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
      "res.headers.etag",
      'res.headers["x-powered-by"]',
      'res.headers["access-control-allow-credentials"]',
      'res.headers["access-control-allow-origin"]',
    ],
    remove: true,
  },
  customProps: getCustomLogProps,
});

/**
 * Wrapper for our logger
 */
export const logger: BaseLogger = {
  error(...args: unknown[]) {
    // eslint-disable-next-line
    // @ts-ignore
    httpLogger.logger.error(...args);
    // eslint-disable-next-line
    // @ts-ignore
    Sentry.captureException(...args);
  },
  debug: httpLogger.logger.debug,
  fatal: httpLogger.logger.fatal,
  info: httpLogger.logger.info,
  level: httpLogger.logger.level,
  silent: httpLogger.logger.silent,
  trace: httpLogger.logger.trace,
  warn: httpLogger.logger.warn,
};

/**
 * pino's logger.child function
 */
export const childLogger = httpLogger.logger.child;
