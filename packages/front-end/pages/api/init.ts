import { NextApiRequest, NextApiResponse } from "next";
import path from "path";
import fs from "fs";

// Get env variables at runtime on the front-end while still using SSG
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const { API_HOST, IS_CLOUD, DISABLE_TELEMETRY } = process.env;

  const hasConfigFile = fs.existsSync(
    path.join(
      __dirname,
      "..",
      "..",
      "..",
      "..",
      "..",
      "..",
      "config",
      "config.yml"
    )
  );

  res.status(200).json({
    apiHost: API_HOST || "http://localhost:3100",
    cloud: !!IS_CLOUD,
    config: hasConfigFile ? "file" : "db",
    telemetry:
      DISABLE_TELEMETRY === "debug"
        ? "debug"
        : DISABLE_TELEMETRY
        ? "disable"
        : "enable",
  });
}
