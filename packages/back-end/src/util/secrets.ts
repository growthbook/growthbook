import Handlebars from "handlebars";
import trimEnd from "lodash/trimEnd";
import { stringToBoolean } from "shared/util";
import {
  GB_SDK_ID_DEV,
  GB_SDK_ID_PROD,
  DEFAULT_METRIC_WINDOW_HOURS,
} from "shared/constants";
import { z } from "zod";

export const ENVIRONMENT = process.env.NODE_ENV;
const prod = ENVIRONMENT === "production";

export const LOG_LEVEL = process.env.LOG_LEVEL;

export const IS_CLOUD = stringToBoolean(process.env.IS_CLOUD);
export const IS_MULTI_ORG = stringToBoolean(process.env.IS_MULTI_ORG);

// Default to true
export const ALLOW_SELF_ORG_CREATION = stringToBoolean(
  process.env.ALLOW_SELF_ORG_CREATION,
  true,
);

export const UPLOAD_METHOD = (() => {
  if (IS_CLOUD) return "s3";

  const method = process.env.UPLOAD_METHOD;
  if (method && ["s3", "google-cloud"].includes(method)) {
    return method;
  }

  return "local";
})();

let MONGODB_URI = process.env.MONGODB_URI || "";

if (!MONGODB_URI) {
  // Check for alternate mongo db environment variables
  if (
    process.env.MONGODB_USERNAME &&
    process.env.MONGODB_PASSWORD &&
    process.env.MONGODB_HOST
  ) {
    const port = process.env.MONGODB_PORT || "27017";
    const dbname = process.env.MONGODB_DBNAME || "growthbook";
    const extraArgs = process.env.MONGODB_EXTRA_ARGS || "?authSource=admin";
    MONGODB_URI = `mongodb://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@${process.env.MONGODB_HOST}:${port}/${dbname}${extraArgs}`;
  }
}

if (!MONGODB_URI) {
  if (prod) {
    throw new Error(
      "Missing MONGODB_URI or required alternate environment variables to generate it",
    );
  }
  MONGODB_URI = "mongodb://root:password@localhost:27017/test?authSource=admin";
}

// For backwards compatibility, if no dbname is explicitly set, use "test" and add the authSource db.
// This matches the default behavior of the MongoDB driver 3.X, which changed when we updated to 4.X
if (MONGODB_URI.match(/:27017(\/)?$/)) {
  MONGODB_URI = trimEnd(MONGODB_URI, "/") + "/test?authSource=admin";
}
export { MONGODB_URI };

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
    "Cannot use ENCRYPTION_KEY=dev in production. Please set to a long random string.",
  );
}

export const GCS_BUCKET_NAME = process.env.GCS_BUCKET_NAME || "";
export const GCS_DOMAIN =
  process.env.GCS_DOMAIN ||
  `https://storage.googleapis.com/${GCS_BUCKET_NAME}/`;

export const JWT_SECRET = process.env.JWT_SECRET || "dev";
if ((prod || !isLocalhost) && !IS_CLOUD && JWT_SECRET === "dev") {
  throw new Error(
    "Cannot use JWT_SECRET=dev in production. Please set to a long random string.",
  );
}

export const AWS_ASSUME_ROLE = process.env.AWS_ASSUME_ROLE || "";

export const EMAIL_ENABLED = stringToBoolean(process.env.EMAIL_ENABLED);
export const EMAIL_HOST = process.env.EMAIL_HOST;
export const EMAIL_PORT = parseInt(process.env.EMAIL_PORT || "") || 587;
export const EMAIL_HOST_USER = process.env.EMAIL_HOST_USER;
export const EMAIL_HOST_PASSWORD = process.env.EMAIL_HOST_PASSWORD;
export const EMAIL_FROM = process.env.EMAIL_FROM;
export const SITE_MANAGER_EMAIL = process.env.SITE_MANAGER_EMAIL;

export const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET || "";

const testConn = process.env.POSTGRES_TEST_CONN;
export const POSTGRES_TEST_CONN = testConn ? JSON.parse(testConn) : {};

export const JOB_TIMEOUT_MS =
  parseInt(process.env.JOB_TIMEOUT_MS || "") || 2 * 60 * 60 * 1000; // Defaults to 2 hours

export const FASTLY_API_TOKEN = process.env.FASTLY_API_TOKEN || "";
export const FASTLY_SERVICE_ID = process.env.FASTLY_SERVICE_ID || "";

// Update results every X hours
export const EXPERIMENT_REFRESH_FREQUENCY =
  parseInt(process.env.EXPERIMENT_REFRESH_FREQUENCY || "") || 6;

export const DEFAULT_CONVERSION_WINDOW_HOURS =
  parseInt(process.env.DEFAULT_CONVERSION_WINDOW_HOURS || "") ||
  DEFAULT_METRIC_WINDOW_HOURS;

// Update metrics every X hours
export const METRIC_REFRESH_FREQUENCY =
  parseInt(process.env.METRIC_REFRESH_FREQUENCY || "") || 24;

export const AUTO_SLICE_UPDATE_FREQUENCY_HOURS =
  parseInt(process.env.AUTO_SLICE_UPDATE_FREQUENCY_HOURS || "") || 168; // Default: 7 days

export const QUERY_CACHE_TTL_MINS =
  parseInt(process.env.QUERY_CACHE_TTL_MINS || "") || 60;

// When importing past experiments, limit to this number of days:
export const IMPORT_LIMIT_DAYS =
  parseInt(process.env?.IMPORT_LIMIT_DAYS || "") || 365;

// cache control currently feature only /api/features/*
export const CACHE_CONTROL_MAX_AGE =
  parseInt(process.env?.CACHE_CONTROL_MAX_AGE || "") || 30;
export const CACHE_CONTROL_STALE_WHILE_REVALIDATE =
  parseInt(process.env?.CACHE_CONTROL_STALE_WHILE_REVALIDATE || "") || 3600;
export const CACHE_CONTROL_STALE_IF_ERROR =
  parseInt(process.env?.CACHE_CONTROL_STALE_IF_ERROR || "") || 36000;

// remote Eval Edge
export const REMOTE_EVAL_EDGE_HOST = process.env.REMOTE_EVAL_EDGE_HOST;
export const REMOTE_EVAL_EDGE_API_TOKEN =
  process.env.REMOTE_EVAL_EDGE_API_TOKEN;

// update Feature every

export const CRON_ENABLED = !stringToBoolean(process.env.CRON_DISABLED);

export const SENTRY_DSN = process.env.SENTRY_DSN || "";

export const STORE_SEGMENTS_IN_MONGO = stringToBoolean(
  process.env.STORE_SEGMENTS_IN_MONGO,
);

// If set to false AND using a config file, don't allow creating metric via the UI
export const ALLOW_CREATE_METRICS = stringToBoolean(
  process.env.ALLOW_CREATE_METRICS,
);

// If set to false AND using a config file, don't allow creating dimension via the UI
export const ALLOW_CREATE_DIMENSIONS = stringToBoolean(
  process.env.ALLOW_CREATE_DIMENSIONS,
);

// Defines the User-Agent header for all requests made by the API
export const API_USER_AGENT =
  process.env.API_USER_AGENT ||
  (IS_CLOUD ? "GrowthBook Cloud (https://app.growthbook.io)" : "GrowthBook");

// Add a default secret access key via an environment variable
// Only allowed while self-hosting and not multi org
let secretAPIKey = IS_MULTI_ORG ? "" : process.env.SECRET_API_KEY || "";
// Don't allow using "dev" (default value) in prod
if ((prod || !isLocalhost) && secretAPIKey === "dev") {
  secretAPIKey = "";
  // eslint-disable-next-line
  console.error(
    "SECRET_API_KEY must be set to a secure value in production. Disabling access.",
  );
}
export const SECRET_API_KEY = secretAPIKey;
// This is typically used for the Proxy Server, which only requires readonly access
export const SECRET_API_KEY_ROLE =
  process.env.SECRET_API_KEY_ROLE || "readonly";
export const PROXY_ENABLED = stringToBoolean(process.env.PROXY_ENABLED);
export const PROXY_HOST_INTERNAL = process.env.PROXY_HOST_INTERNAL || "";
export const PROXY_HOST_PUBLIC = process.env.PROXY_HOST_PUBLIC || "";

// global webhooks
const webhooksString = process.env.WEBHOOKS;
const webhooksValidator = z.array(
  z
    .object({
      url: z.string(),
      headers: z.unknown().optional(),
      signingKey: z.string().optional(),
      method: z
        .enum(["GET", "POST", "PUT", "DELETE", "PATCH", "PURGE"])
        .optional(),
      sendPayload: z.boolean().optional(),
      payloadFormat: z
        .enum([
          "standard",
          "standard-no-payload",
          "sdkPayload",
          "edgeConfig",
          "edgeConfigUnescaped",
          "vercelNativeIntegration",
          "none",
        ])
        .optional(),
      payloadKey: z.string().optional(),
    })
    .strict(),
);
let webhooks: z.infer<typeof webhooksValidator> = [];
try {
  webhooks = webhooksString
    ? webhooksValidator.parse(JSON.parse(webhooksString))
    : [];
} catch (error) {
  throw Error(`webhooks in env file is malformed: ${error.message}`);
}
export const WEBHOOKS = webhooks;
export const WEBHOOK_PROXY = process.env.WEBHOOK_PROXY || "";

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

// If a request proxy is configured using environment variables
export const USE_PROXY =
  !!process.env.http_proxy ||
  !!process.env.https_proxy ||
  !!process.env.HTTPS_PROXY;

export const SUPERADMIN_DEFAULT_ROLE =
  process.env.SUPERADMIN_DEFAULT_ROLE ?? "readonly";

export const CLICKHOUSE_HOST = process.env.CLICKHOUSE_HOST || "";
export const CLICKHOUSE_ADMIN_USER = process.env.CLICKHOUSE_ADMIN_USER || "";
export const CLICKHOUSE_ADMIN_PASSWORD =
  process.env.CLICKHOUSE_ADMIN_PASSWORD || "";
export const CLICKHOUSE_DATABASE = process.env.CLICKHOUSE_DATABASE || "";
export const CLICKHOUSE_MAIN_TABLE = process.env.CLICKHOUSE_MAIN_TABLE || "";
export const CLICKHOUSE_OVERAGE_TABLE =
  process.env.CLICKHOUSE_OVERAGE_TABLE || "overage_events";
export const CLICKHOUSE_DEV_PREFIX =
  process.env.CLICKHOUSE_DEV_PREFIX || "test_";

// Note: the Visual Editor relies on the information in this path, so disabling it will prevent some features from working correctly.
export const DISABLE_API_ROOT_PATH = stringToBoolean(
  process.env.DISABLE_API_ROOT_PATH,
);

export const GB_SDK_ID = prod ? GB_SDK_ID_PROD : GB_SDK_ID_DEV;

export type SecretsReplacer = <T extends string | Record<string, string>>(
  s: T,
  options?: {
    encode?: (s: string) => string;
  },
) => T;

export const secretsReplacer = (
  secrets: Record<string, string>,
): SecretsReplacer => {
  return ((s, options) => {
    const encode = options?.encode || ((s: string) => s);

    const encodedSecrets = Object.keys(secrets).reduce<Record<string, string>>(
      (encoded, key) => ({
        ...encoded,
        [key]: encode(secrets[key]),
      }),
      {},
    );

    const stringReplacer = (s: string) => {
      const template = Handlebars.compile(s, {
        noEscape: true,
        strict: true,
      });
      return template(encodedSecrets);
    };

    if (typeof s === "string") return stringReplacer(s);

    return Object.keys(s).reduce<Record<string, string>>(
      (obj, key) => ({
        ...obj,
        [stringReplacer(key)]: stringReplacer(s[key]),
      }),
      {},
    );
  }) as SecretsReplacer;
};
