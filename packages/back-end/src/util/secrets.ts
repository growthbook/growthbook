import fs from "fs";
import dotenv from "dotenv";

if (fs.existsSync(".env.local")) {
  dotenv.config({ path: ".env.local" });
}

import trimEnd from "lodash/trimEnd";
import { verifyCloud } from "enterprise";
import { logger } from "./logger";

export const ENVIRONMENT = process.env.NODE_ENV;
const prod = ENVIRONMENT === "production";

export const IS_CLOUD = !!process.env.IS_CLOUD;

async function checkCloud() {
  if (IS_CLOUD) {
    try {
      await verifyCloud();
    } catch {
      logger.error("Failed to verify that we are on the real cloud.");
      process.kill(process.pid, "SIGTERM");
    }
  }
}
checkCloud();

export const UPLOAD_METHOD = (() => {
  if (IS_CLOUD) return "s3";

  const method = process.env.UPLOAD_METHOD;
  if (method && ["s3", "google-cloud"].includes(method)) {
    return method;
  }

  return "local";
})();

export let MONGODB_URI =
  process.env.MONGODB_URI ??
  (prod ? "" : "mongodb://root:password@localhost:27017/test?authSource=admin");
if (!MONGODB_URI) {
  throw new Error("Missing MONGODB_URI environment variable");
}

// For backwards compatibility, if no dbname is explicitly set, use "test" and add the authSource db.
// This matches the default behavior of the MongoDB driver 3.X, which changed when we updated to 4.X
if (MONGODB_URI.match(/:27017(\/)?$/)) {
  MONGODB_URI = trimEnd(MONGODB_URI, "/") + "/test?authSource=admin";
}

export const APP_ORIGIN = process.env.APP_ORIGIN || "http://localhost:3000";
const isLocalhost = APP_ORIGIN.includes("localhost");

const corsOriginRegex = process.env.CORS_ORIGIN_REGEX;
export const CORS_ORIGIN_REGEX = corsOriginRegex
  ? new RegExp(corsOriginRegex, "i")
  : null;

export const GOOGLE_OAUTH_CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID || "";
export const GOOGLE_OAUTH_CLIENT_SECRET =
  process.env.GOOGLE_OAUTH_CLIENT_SECRET || "";

export const S3_BUCKET = process.env.S3_BUCKET || "";
export const S3_REGION = process.env.S3_REGION || "us-east-1";
export const S3_DOMAIN =
  process.env.S3_DOMAIN || `https://${S3_BUCKET}.s3.amazonaws.com/`;
export const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "dev";
if (prod && ENCRYPTION_KEY === "dev") {
  throw new Error(
    "Cannot use ENCRYPTION_KEY=dev in production. Please set to a long random string."
  );
}

export const GCS_BUCKET_NAME = process.env.GCS_BUCKET_NAME || "";
export const GCS_DOMAIN =
  process.env.GCS_DOMAIN ||
  `https://storage.googleapis.com/${GCS_BUCKET_NAME}/`;

export const JWT_SECRET = process.env.JWT_SECRET || "dev";
if ((prod || !isLocalhost) && !IS_CLOUD && JWT_SECRET === "dev") {
  throw new Error(
    "Cannot use JWT_SECRET=dev in production. Please set to a long random string."
  );
}

export const EMAIL_ENABLED = process.env.EMAIL_ENABLED === "true";
export const EMAIL_HOST = process.env.EMAIL_HOST;
export const EMAIL_PORT = parseInt(process.env.EMAIL_PORT || "") || 587;
export const EMAIL_HOST_USER = process.env.EMAIL_HOST_USER;
export const EMAIL_HOST_PASSWORD = process.env.EMAIL_HOST_PASSWORD;
export const EMAIL_FROM = process.env.EMAIL_FROM;
export const SITE_MANAGER_EMAIL = process.env.SITE_MANAGER_EMAIL;

export const STRIPE_SECRET = process.env.STRIPE_SECRET || "";
export const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "";
export const STRIPE_PRICE = process.env.STRIPE_PRICE || "";

export const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET || "";

const testConn = process.env.POSTGRES_TEST_CONN;
export const POSTGRES_TEST_CONN = testConn ? JSON.parse(testConn) : {};

export const FASTLY_API_TOKEN = process.env.FASTLY_API_TOKEN || "";
export const FASTLY_SERVICE_ID = process.env.FASTLY_SERVICE_ID || "";

// Update results every X hours
export const EXPERIMENT_REFRESH_FREQUENCY =
  parseInt(process.env.EXPERIMENT_REFRESH_FREQUENCY || "") || 6;

export const DEFAULT_CONVERSION_WINDOW_HOURS =
  parseInt(process.env.DEFAULT_CONVERSION_WINDOW_HOURS || "") || 72;

// Update metrics every X hours
export const METRIC_REFRESH_FREQUENCY =
  parseInt(process.env.METRIC_REFRESH_FREQUENCY || "") || 24;

export const QUERY_CACHE_TTL_MINS =
  parseInt(process.env.QUERY_CACHE_TTL_MINS || "") || 60;

// When importing past experiments, limit to this number of days:
export const IMPORT_LIMIT_DAYS =
  parseInt(process.env?.IMPORT_LIMIT_DAYS || "") || 365;

export const CRON_ENABLED = !process.env.CRON_DISABLED;

export const VERCEL_CLIENT_ID = process.env.VERCEL_CLIENT_ID || "";
export const VERCEL_CLIENT_SECRET = process.env.VERCEL_CLIENT_SECRET || "";

export const SENTRY_DSN = process.env.SENTRY_DSN || "";

export const STORE_SEGMENTS_IN_MONGO = !!process.env.STORE_SEGMENTS_IN_MONGO;
// Add a default secret access key via an environment variable
// Only allowed while self-hosting, don't allow using "dev" (default value) in prod
let secretAPIKey = IS_CLOUD ? "" : process.env.SECRET_API_KEY || "";
if ((prod || !isLocalhost) && secretAPIKey === "dev") {
  secretAPIKey = "";
  // eslint-disable-next-line
  console.error(
    "SECRET_API_KEY must be set to a secure value in production. Disabling access."
  );
}
export const SECRET_API_KEY = secretAPIKey;
// This is typically used for the Proxy Server, which only requires readonly access
export const SECRET_API_KEY_ROLE =
  process.env.SECRET_API_KEY_ROLE || "readonly";
export const PROXY_ENABLED = !!process.env.PROXY_ENABLED;
export const PROXY_HOST_INTERNAL = process.env.PROXY_HOST_INTERNAL || "";
export const PROXY_HOST_PUBLIC = process.env.PROXY_HOST_PUBLIC || "";

/**
 * Allows custom configuration of the trust proxy settings as
 * described in the docs: https://expressjs.com/en/5x/api.html#trust.proxy.options.table
 *
 * Supports true/false for boolean values.
 * Supports integer values to trust the nth hop from the front-facing proxy server as the client.
 * All other truthy values will be used verbatim.
 */
const getTrustProxyConfig = (): boolean | string | number => {
  const value = process.env.EXPRESS_TRUST_PROXY_OPTS;

  // If no value set, return false
  if (!value) {
    return false;
  }

  // Lower-cased value to enable easier boolean config
  const lowerCasedValue = value.toLowerCase();
  if (lowerCasedValue === "true") return true;
  if (lowerCasedValue === "false") return false;

  // Check for nth hop config
  //    Trust the nth hop from the front-facing proxy server as the client.
  if (value.match(/^[0-9]+$/)) {
    return parseInt(value);
  }

  // If not a recognized boolean format or a valid integer, return value verbatim
  return value;
};

export const EXPRESS_TRUST_PROXY_OPTS = getTrustProxyConfig();
