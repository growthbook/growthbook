import dotenv from "dotenv";
import fs from "fs";

export const ENVIRONMENT = process.env.NODE_ENV;
const prod = ENVIRONMENT === "production";

if (fs.existsSync(".env.local")) {
  dotenv.config({ path: ".env.local" });
}

export const IS_CLOUD = !!process.env.IS_CLOUD;

export const UPLOAD_METHOD =
  IS_CLOUD || process.env.UPLOAD_METHOD === "s3" ? "s3" : "local";

export const MONGODB_URI =
  process.env.MONGODB_URI ??
  (prod ? "" : "mongodb://root:password@localhost:27017/");
if (!MONGODB_URI) {
  throw new Error("Missing MONGODB_URI environment variable");
}

export const APP_ORIGIN = process.env.APP_ORIGIN || "http://localhost:3000";

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

export const JWT_SECRET = process.env.JWT_SECRET || "dev";
if (prod && !IS_CLOUD && JWT_SECRET === "dev") {
  throw new Error(
    "Cannot use JWT_SECRET=dev in production. Please set to a long random string."
  );
}

export const EMAIL_ENABLED = process.env.EMAIL_ENABLED === "true";
export const EMAIL_HOST = process.env.EMAIL_HOST;
export const EMAIL_PORT = parseInt(process.env.EMAIL_PORT || "") || 587;
export const EMAIL_HOST_USER = process.env.EMAIL_HOST_USER;
export const EMAIL_HOST_PASSWORD = process.env.EMAIL_HOST_PASSWORD;
export const EMAIL_USE_TLS = !!process.env.EMAIL_USE_TLS;
export const EMAIL_FROM = process.env.EMAIL_FROM;
export const SITE_MANAGER_EMAIL = process.env.SITE_MANAGER_EMAIL;

export const STRIPE_SECRET = process.env.STRIPE_SECRET || "";
export const STRIPE_PRICE = process.env.STRIPE_PRICE || "";
export const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "";
export const STRIPE_DEFAULT_COUPON = process.env.STRIPE_DEFAULT_COUPON || "";

export const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET || "";

const testConn = process.env.POSTGRES_TEST_CONN;
export const POSTGRES_TEST_CONN = testConn ? JSON.parse(testConn) : {};

export const AWS_CLOUDFRONT_DISTRIBUTION_ID =
  process.env.AWS_CLOUDFRONT_DISTRIBUTION_ID || "";

// Update results every X hours
export const EXPERIMENT_REFRESH_FREQUENCY =
  parseInt(process.env.EXPERIMENT_REFRESH_FREQUENCY || "") || 6;

export const DEFAULT_CONVERSION_WINDOW_HOURS =
  parseInt(process.env.DEFAULT_CONVERSION_WINDOW_HOURS || "") || 72;

// Update metrics every X hours
export const METRIC_REFRESH_FREQUENCY =
  parseInt(process.env.METRIC_REFRESH_FREQUENCY || "") || 24;
