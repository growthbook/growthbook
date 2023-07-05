import { NextFunction, Request, Response } from "express";
import { GrowthBook } from "@growthbook/growthbook";
import { AppFeatures } from "front-end/types/app-features";

export default async function growthbookMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  req.app.locals.growthbook = new GrowthBook<AppFeatures>({
    apiHost: "https://cdn.growthbook.io",
    clientKey:
      process.env.NODE_ENV === "production"
        ? "sdk-ueFMOgZ2daLa0M"
        : "sdk-UmQ03OkUDAu7Aox",
    enableDevMode: true,
  });

  res.on("close", () => {
    req.app.locals.growthbook.destroy();
  });

  // Do not subscribe individual SDK instances to streaming updates
  try {
    await req.app.locals.growthbook.loadFeatures({ autoRefresh: false });
  } catch (e) {
    req.log.error(e, "Failed to load features from GrowthBook");
  }

  next();
}
