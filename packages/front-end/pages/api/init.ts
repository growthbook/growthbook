import path from "path";
import fs from "fs";
import { NextApiRequest, NextApiResponse } from "next";
import { stringToBoolean } from "shared/util";

export interface EnvironmentInitValue {
  telemetry: "debug" | "enable" | "disable";
  cloud: boolean;
  isMultiOrg?: boolean;
  allowSelfOrgCreation: boolean;
  showMultiOrgSelfSelector: boolean;
  appOrigin: string;
  apiHost: string;
  s3domain: string;
  gcsDomain: string;
  cdnHost: string;
  config: "file" | "db";
  defaultConversionWindowHours: number;
  build?: {
    sha: string;
    date: string;
  };
  sentryDSN: string;
  usingSSO: boolean;
  storeSegmentsInMongo: boolean;
  allowCreateMetrics: boolean;
  usingFileProxy: boolean;
}

// Get env variables at runtime on the front-end while still using SSG
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const {
    APP_ORIGIN,
    API_HOST,
    S3_DOMAIN,
    S3_BUCKET,
    GCS_DOMAIN,
    GCS_BUCKET_NAME,
    CDN_HOST,
    IS_CLOUD,
    IS_MULTI_ORG,
    ALLOW_SELF_ORG_CREATION,
    SHOW_MULTI_ORG_SELF_SELECTOR,
    DISABLE_TELEMETRY,
    DEFAULT_CONVERSION_WINDOW_HOURS,
    NEXT_PUBLIC_SENTRY_DSN,
    SSO_CONFIG,
    STORE_SEGMENTS_IN_MONGO,
    ALLOW_CREATE_METRICS,
    USE_FILE_PROXY: USING_FILE_PROXY,
  } = process.env;

  const rootPath = path.join(__dirname, "..", "..", "..", "..", "..", "..");

  const hasConfigFile = fs.existsSync(
    path.join(rootPath, "config", "config.yml")
  );

  const build = {
    sha: "",
    date: "",
  };
  if (fs.existsSync(path.join(rootPath, "buildinfo", "SHA"))) {
    build.sha = fs
      .readFileSync(path.join(rootPath, "buildinfo", "SHA"))
      .toString();
  }
  if (fs.existsSync(path.join(rootPath, "buildinfo", "DATE"))) {
    build.date = fs
      .readFileSync(path.join(rootPath, "buildinfo", "DATE"))
      .toString();
  }

  const body: EnvironmentInitValue = {
    appOrigin: APP_ORIGIN || "http://localhost:3000",
    apiHost: API_HOST || "http://localhost:3100",
    s3domain:
      S3_DOMAIN || (S3_BUCKET ? `https://${S3_BUCKET}.s3.amazonaws.com/` : ""),
    gcsDomain:
      GCS_DOMAIN ||
      (GCS_BUCKET_NAME
        ? `https://storage.googleapis.com/${GCS_BUCKET_NAME}/`
        : ""),
    cdnHost: CDN_HOST || "",
    cloud: stringToBoolean(IS_CLOUD),
    isMultiOrg: stringToBoolean(IS_MULTI_ORG),
    allowSelfOrgCreation: stringToBoolean(ALLOW_SELF_ORG_CREATION, true), // Default to true
    showMultiOrgSelfSelector: stringToBoolean(
      SHOW_MULTI_ORG_SELF_SELECTOR,
      true
    ),
    config: hasConfigFile ? "file" : "db",
    allowCreateMetrics: !hasConfigFile || stringToBoolean(ALLOW_CREATE_METRICS),
    build,
    defaultConversionWindowHours: DEFAULT_CONVERSION_WINDOW_HOURS
      ? parseInt(DEFAULT_CONVERSION_WINDOW_HOURS)
      : 72,
    telemetry:
      DISABLE_TELEMETRY === "debug"
        ? "debug"
        : DISABLE_TELEMETRY
        ? "disable"
        : "enable",
    sentryDSN: NEXT_PUBLIC_SENTRY_DSN || "",
    usingSSO: !!SSO_CONFIG, // No matter what SSO_CONFIG is set to we want it to count as using it.
    storeSegmentsInMongo: stringToBoolean(STORE_SEGMENTS_IN_MONGO),
    usingFileProxy: stringToBoolean(USING_FILE_PROXY),
  };

  res.status(200).json(body);
}
