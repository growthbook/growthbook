import { Router, Request, Response, NextFunction } from "express";
import { ApiRequestLocals } from "../../../types/api";
import { lookupOrganizationByApiKey } from "../../models/ApiKeyModel";
import { getOrganizationById } from "../../services/organizations";
import { listFeatures } from "./features.controller";

function authencateApiRequestMiddleware(
  req: Request & ApiRequestLocals,
  res: Response,
  next: NextFunction
) {
  // Get secret key from Authorization header and store in req
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(400).json({
      error: "Missing Authorization header",
    });
  }
  const secretKey = authHeader.split(" ")[1];
  if (!secretKey) {
    return res.status(400).json({
      error: "Missing API key in Authorization header",
    });
  }
  req.apiKey = secretKey;

  // Lookup organization by secret key and store in req
  lookupOrganizationByApiKey(secretKey)
    .then(async ({ organization, secret }) => {
      if (!organization) {
        throw new Error("Invalid API key");
      }
      if (!secret) {
        throw new Error(
          "Must use a Secret API Key for this request, SDK Endpoint key given instead."
        );
      }
      const org = await getOrganizationById(organization);
      if (!org) {
        throw new Error("Could not find organization attached to this API key");
      }
      req.organization = org;

      // Continue to the actual request handler
      next();
    })
    .catch((e) => {
      res.status(400).json({
        error: e.message,
      });
    });
}

const router = Router();

router.use(authencateApiRequestMiddleware);

router.get("/features", listFeatures);

export default router;
