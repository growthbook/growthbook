import pinoHttp from "pino-http";
import { Request } from "express";
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

export const logger = httpLogger.logger;
