import { Response, NextFunction } from "express";
import { getAccountPlan } from "enterprise";
import { AuthRequest } from "../../types/AuthRequest";
import { usingOpenId } from "../../services/auth";

export default function scimMiddleware(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  const acceptHeader = req.get("Accept");

  if (!req.organization) {
    return res.status(400).json({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      status: "400",
      detail: "Organization is required but missing in the request.",
    });
  }

  if (getAccountPlan(req.organization) !== "enterprise") {
    return res.status(500).json({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      status: "403",
      detail: "SCIM is not available for this GrowthBook organization.",
    });
  }

  if (!usingOpenId()) {
    return res.status(500).json({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      status: "403",
      detail:
        "SCIM is not available for Growthbook organizations not using SSO.",
    });
  }

  // Check if the Accept header specifies SCIM JSON
  if (acceptHeader && acceptHeader.includes("application/scim+json")) {
    res.setHeader("Content-Type", "application/scim+json");
  }

  // Continue processing the request
  next();
}
