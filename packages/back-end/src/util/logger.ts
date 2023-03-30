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

export const logger: BaseLogger = {
  debug(...args: unknown[]) {
    // eslint-disable-next-line
    // @ts-ignore
    httpLogger.logger.debug(...args);
  },
  error(...args: unknown[]) {
    // eslint-disable-next-line
    // @ts-ignore
    httpLogger.logger.error(...args);
    // eslint-disable-next-line
    // @ts-ignore
    Sentry.captureException(...args);
  },
  fatal(...args: unknown[]) {
    // eslint-disable-next-line
    // @ts-ignore
    Sentry.captureException(...args);
    // eslint-disable-next-line
    // @ts-ignore
    httpLogger.logger.fatal(...args);
  },
  info(...args: unknown[]) {
    // eslint-disable-next-line
    // @ts-ignore
    httpLogger.logger.info(...args);
  },
  level: httpLogger.logger.level,
  silent(...args: unknown[]) {
    // eslint-disable-next-line
    // @ts-ignore
    httpLogger.logger.silent(...args);
  },
  trace(...args: unknown[]) {
    // eslint-disable-next-line
    // @ts-ignore
    httpLogger.logger.trace(...args);
  },
  warn(...args: unknown[]) {
    // eslint-disable-next-line
    // @ts-ignore
    httpLogger.logger.warn(...args);
    Sentry.captureMessage(JSON.stringify(args));
  },
};
