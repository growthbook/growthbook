import path from "path";
import fs from "fs";
import { NextApiRequest, NextApiResponse } from "next";
import { stringToBoolean } from "shared/util";

export interface EnvironmentInitValue {
  telemetry: "debug" | "enable" | "disable";
  cloud: boolean;
  isMultiOrg?: boolean;
  allowSelfOrgCreation: boolean;
  appOrigin: string;
  apiHost: string;
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
}

// Get env variables at runtime on the front-end while still using SSG
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const {
    APP_ORIGIN,
    API_HOST,
    CDN_HOST,
    IS_CLOUD,
    IS_MULTI_ORG,
    ALLOW_SELF_ORG_CREATION,
    DISABLE_TELEMETRY,
    DEFAULT_CONVERSION_WINDOW_HOURS,
    NEXT_PUBLIC_SENTRY_DSN,
    SSO_CONFIG,
    STORE_SEGMENTS_IN_MONGO,
    ALLOW_CREATE_METRICS,
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
    cdnHost: CDN_HOST || "",
    cloud: stringToBoolean(IS_CLOUD),
    isMultiOrg: stringToBoolean(IS_MULTI_ORG),
    allowSelfOrgCreation: stringToBoolean(ALLOW_SELF_ORG_CREATION, true), // Default to true
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
  };

  res.status(200).json(body);
}
