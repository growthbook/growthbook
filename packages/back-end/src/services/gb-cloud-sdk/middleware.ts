import { NextFunction, Request, Response } from "express";
import {
  GrowthBook,
  Attributes,
  setPolyfills,
  prefetchPayload,
} from "@growthbook/growthbook";
import { AppFeatures } from "front-end/types/app-features";
import { GROWTHBOOK_SECURE_ATTRIBUTE_SALT } from "shared/constants";
import { getAccountPlan, getLicense } from "enterprise";
import { IS_CLOUD } from "../../util/secrets";
import { AuthRequest } from "../../types/AuthRequest";
import { sha256 } from "../features";
import { logger } from "../../util/logger";

setPolyfills({
  fetch: require("node-fetch"),
  EventSource: require("eventsource"),
});

const cdnHost = process.env.GROWTHBOOK_CDN_HOST || "https://cdn.growthbook.io";
const clientKey =
  process.env.GROWTHBOOK_CLIENT_KEY ||
  (process.env.NODE_ENV === "production"
    ? "sdk-ueFMOgZ2daLa0M"
    : "sdk-UmQ03OkUDAu7Aox");

// Start a streaming connection
prefetchPayload({
  apiHost: cdnHost,
  clientKey: clientKey,
  streaming: true,
}).then(() => logger.debug("Streaming connection open!"));

export async function initializeSdk() {
  const gb = new GrowthBook<AppFeatures>({
    apiHost: cdnHost,
    clientKey: clientKey,
  });

  try {
    // While individual gb instances are not streaming to avoid weird edge cases where a feature's value changes mid request
    // However by running prefetchPayload above we still get up to the moment data.
    await gb.init({
      streaming: false,
      timeout: 1000,
    });
  } catch (e) {
    logger.error(e, "Failed to load features from GrowthBook");
  }

  return gb;
}

export async function initializeSdkForRequest(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const gb = await initializeSdk();
  req.app.locals.growthbook = gb;

  res.on("close", () => {
    gb.destroy();
  });

  next();
}

export async function setAttributes(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  const gb = req.app.locals.growthbook as GrowthBook<AppFeatures> | undefined;
  if (gb) {
    const attributes: Attributes = {
      id: req?.userId || "",
      name: req?.name || "",
      admin: req?.superAdmin || false,
      company: req?.organization?.name || "",
      organizationId: req?.organization?.id
        ? sha256(req.organization.id, GROWTHBOOK_SECURE_ATTRIBUTE_SALT)
        : "",
      url: req.get("Referrer") || "",
      cloud: IS_CLOUD,
      accountPlan: req?.organization
        ? getAccountPlan(req?.organization) || "unknown"
        : "unknown",
      hasLicenseKey: IS_CLOUD
        ? req.organization && getAccountPlan(req.organization) !== "starter"
        : !!getLicense(),
      freeSeats: req?.organization?.freeSeats || 3,
      discountCode: req?.organization?.discountCode || "",
    };
    gb.setAttributes(attributes);
  }
  next();
}
