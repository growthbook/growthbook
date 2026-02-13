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
import { ENVIRONMENT, IS_CLOUD, LOG_LEVEL } from "./secrets.js";

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

/**
 * Wrapper for our logger
 */
export const logger: BaseLogger = {
  debug(...args: Parameters<BaseLogger["debug"]>) {
    httpLogger.logger.debug(...args);
  },
  error(...args: Parameters<BaseLogger["error"]>) {
    httpLogger.logger.error(...args);
    logToSentry(...args);
  },
  fatal(...args: Parameters<BaseLogger["fatal"]>) {
    httpLogger.logger.fatal(...args);
    logToSentry(...args);
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

function logToSentry(...args: Parameters<BaseLogger["error" | "fatal"]>) {
  // Ideally Pino typing would be better, but it's not
  const [obj, message, ...rest] = args as [
    string | Error | { err?: Error; [key: string]: unknown },
    string | unknown,
    ...unknown[],
  ];

  Sentry.withScope((scope) => {
    if (typeof obj === "string") {
      const msg = format(obj, message, ...rest);
      Sentry.captureException(new Error(msg));
      return;
    }

    if (obj instanceof Error) {
      const msg = format(message, ...rest);
      const errorToCapture = msg
        ? new ErrorWrapper(msg, {
            message: obj.message,
            stack: obj.stack,
          })
        : obj;
      Sentry.captureException(errorToCapture);
      return;
    }

    if (typeof obj === "object" && obj !== null) {
      const msg = format(message, ...rest);

      let errorToCapture;
      if ("err" in obj && obj.err) {
        errorToCapture = msg
          ? new ErrorWrapper(msg, {
              message: obj.err.message,
              stack: obj.err.stack,
            })
          : obj.err;
      } else {
        errorToCapture = new Error(msg);
      }

      delete (obj as Record<string, unknown>).err; // Do not double log the error
      scope.setExtras(obj as Record<string, unknown>);
      Sentry.captureException(errorToCapture);
    }
  });
}
