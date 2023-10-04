import path from "path";
import fs from "fs";
import { NextApiRequest, NextApiResponse } from "next";

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
    cloud: IS_CLOUD === "true",
    isMultiOrg: IS_MULTI_ORG === "true",
    allowSelfOrgCreation: ALLOW_SELF_ORG_CREATION !== "false", // Default to true, false only if explicitly set to "false"
    config: hasConfigFile ? "file" : "db",
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
    usingSSO: !!SSO_CONFIG,
    storeSegmentsInMongo: !!STORE_SEGMENTS_IN_MONGO,
  };

  res.status(200).json(body);
}
