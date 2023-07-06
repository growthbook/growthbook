import { NextFunction, Request, Response } from "express";
import { Attributes, configureCache, GrowthBook } from "@growthbook/growthbook";
import { AppFeatures } from "front-end/types/app-features";
import { GROWTHBOOK_SECURE_ATTRIBUTE_SALT } from "shared/constants";
import { IS_CLOUD } from "../../util/secrets";
import { AuthRequest } from "../../types/AuthRequest";
import { getAccountPlan } from "../../util/organization.util";
import { sha256 } from "../features";
import { getLicense } from "../../init/license";
import { getGbCloudSdkPayload } from "./index";

export async function initializeSdk(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const gb = new GrowthBook<AppFeatures>({
    apiHost: "https://cdn.growthbook.io",
    clientKey:
      process.env.NODE_ENV === "production"
        ? "sdk-ueFMOgZ2daLa0M"
        : "sdk-UmQ03OkUDAu7Aox",
    enableDevMode: true,
  });
  req.app.locals.growthbook = gb;

  // Disable SSE
  configureCache({ backgroundSync: false });

  res.on("close", () => {
    gb.destroy();
  });

  try {
    if (IS_CLOUD) {
      const payload = await getGbCloudSdkPayload();
      gb.setFeatures(payload.features);
      // @ts-expect-error AutoExperiment[] is not exported
      gb.setExperiments(payload.experiments || []);
    } else {
      // Do not subscribe individual SDK instances to streaming updates
      await gb.loadFeatures({ autoRefresh: false });
    }
  } catch (e) {
    req.log.error(e, "Failed to load features from GrowthBook");
  }

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
      admin: req?.admin || false,
      company: req?.organization?.name || "",
      organizationId: req?.organization?.id
        ? sha256(req.organization.id, GROWTHBOOK_SECURE_ATTRIBUTE_SALT)
        : "",
      url: req.get("Referrer") || "",
      cloud: IS_CLOUD,
      accountPlan: req?.organization
        ? getAccountPlan(req?.organization) || "unknown"
        : "unknown",
      hasLicenseKey: !!getLicense(),
      freeSeats: req?.organization?.freeSeats || 3,
      discountCode: req?.organization?.discountCode || "",
    };
    gb.setAttributes(attributes);
  }
  next();
}
