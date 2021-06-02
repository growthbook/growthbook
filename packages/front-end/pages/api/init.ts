import { NextApiRequest, NextApiResponse } from "next";

// Get env variables at runtime on the front-end while still using SSG
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const { API_HOST, IS_CLOUD, DISABLE_TELEMETRY } = process.env;

  res.status(200).json({
    apiHost: API_HOST || "http://localhost:3100",
    cloud: !!IS_CLOUD,
    telemetry:
      DISABLE_TELEMETRY === "debug"
        ? "debug"
        : DISABLE_TELEMETRY
        ? "disable"
        : "enable",
  });
}
