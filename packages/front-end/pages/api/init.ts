import path from "path";
import fs from "fs";
import { NextApiRequest, NextApiResponse } from "next";
import { stringToBoolean } from "shared/util";

export interface EnvironmentInitValue {
  telemetry: "debug" | "enable" | "disable" | "enable-with-debug";
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
  environment: string;
  build?: {
    sha: string;
    date: string;
    lastVersion: string;
  };
  sentryDSN: string;
  usingSSO: boolean;
  storeSegmentsInMongo: boolean;
  allowCreateMetrics: boolean;
  allowCreateDimensions: boolean;
  usingFileProxy: boolean;
  superadminDefaultRole: string;
  ingestorOverride: string;
  stripePublishableKey: string;
  experimentRefreshFrequency: number;
  hasOpenAIKey?: boolean;
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
    INGESTOR_HOST,
    ALLOW_SELF_ORG_CREATION,
    SHOW_MULTI_ORG_SELF_SELECTOR,
    DISABLE_TELEMETRY,
    DEFAULT_CONVERSION_WINDOW_HOURS,
    NEXT_PUBLIC_SENTRY_DSN,
    NODE_ENV,
    SSO_CONFIG,
    STORE_SEGMENTS_IN_MONGO,
    ALLOW_CREATE_METRICS,
    ALLOW_CREATE_DIMENSIONS,
    USE_FILE_PROXY: USING_FILE_PROXY,
    SUPERADMIN_DEFAULT_ROLE,
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
    EXPERIMENT_REFRESH_FREQUENCY,
    OPENAI_API_KEY,
  } = process.env;

  const rootPath = path.join(__dirname, "..", "..", "..", "..", "..", "..");

  const hasConfigFile = fs.existsSync(
    path.join(rootPath, "config", "config.yml")
  );

  const build = {
    sha: "",
    date: "",
    lastVersion: "",
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

  // Read version from package.json
  try {
    const packageJSONPath = path.join(rootPath, "package.json");
    if (fs.existsSync(packageJSONPath)) {
      const json = JSON.parse(fs.readFileSync(packageJSONPath).toString());
      build.lastVersion = json.version;
    }
  } catch (e) {
    // Ignore errors here, not important
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
    allowSelfOrgCreation: stringToBoolean(ALLOW_SELF_ORG_CREATION),
    showMultiOrgSelfSelector: stringToBoolean(
      SHOW_MULTI_ORG_SELF_SELECTOR,
      true
    ),
    config: hasConfigFile ? "file" : "db",
    allowCreateMetrics: !hasConfigFile || stringToBoolean(ALLOW_CREATE_METRICS),
    allowCreateDimensions:
      !hasConfigFile || stringToBoolean(ALLOW_CREATE_DIMENSIONS),
    build,
    environment: NODE_ENV || "development",
    defaultConversionWindowHours: DEFAULT_CONVERSION_WINDOW_HOURS
      ? parseInt(DEFAULT_CONVERSION_WINDOW_HOURS)
      : 72,
    telemetry:
      DISABLE_TELEMETRY === "debug"
        ? "debug"
        : DISABLE_TELEMETRY === "enable-with-debug"
        ? "enable-with-debug"
        : DISABLE_TELEMETRY
        ? "disable"
        : "enable",
    sentryDSN: NEXT_PUBLIC_SENTRY_DSN || "",
    usingSSO: !!SSO_CONFIG, // No matter what SSO_CONFIG is set to we want it to count as using it.
    storeSegmentsInMongo: stringToBoolean(STORE_SEGMENTS_IN_MONGO),
    usingFileProxy: stringToBoolean(USING_FILE_PROXY),
    superadminDefaultRole: SUPERADMIN_DEFAULT_ROLE || "readonly",
    ingestorOverride: INGESTOR_HOST || "",
    stripePublishableKey: NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || "",
    experimentRefreshFrequency: EXPERIMENT_REFRESH_FREQUENCY
      ? parseInt(EXPERIMENT_REFRESH_FREQUENCY)
      : 6,
    hasOpenAIKey: !!OPENAI_API_KEY || false,
  };

  res.setHeader("Cache-Control", "max-age=3600").status(200).json(body);
}
