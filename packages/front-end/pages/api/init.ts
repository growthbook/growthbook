import { NextApiRequest, NextApiResponse } from "next";
import path from "path";
import fs from "fs";

// Get env variables at runtime on the front-end while still using SSG
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const {
    APP_ORIGIN,
    API_HOST,
    IS_CLOUD,
    DISABLE_TELEMETRY,
    DEFAULT_CONVERSION_WINDOW_HOURS,
    NEXT_PUBLIC_SENTRY_DSN,
    ENABLE_API_CREDENTIALS,
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
  res.status(200).json({
    appOrigin: APP_ORIGIN || "http://localhost:3000",
    apiHost: API_HOST || "http://localhost:3100",
    cloud: !!IS_CLOUD,
    config: hasConfigFile ? "file" : "db",
    build,
    defaultConversionWindowHours:
      parseInt(DEFAULT_CONVERSION_WINDOW_HOURS) || 72,
    telemetry:
      DISABLE_TELEMETRY === "debug"
        ? "debug"
        : DISABLE_TELEMETRY
        ? "disable"
        : "enable",
    sentryDSN: NEXT_PUBLIC_SENTRY_DSN || "",
    apiCredentials: !!ENABLE_API_CREDENTIALS,
  });
}
