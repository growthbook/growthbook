import { Response, NextFunction } from "express";
import { usingOpenId } from "back-end/src/services/auth";
import { BaseScimRequest, ScimError } from "back-end/types/scim";
import { orgHasPremiumFeature } from "back-end/src/enterprise";

export default function scimMiddleware(
  req: BaseScimRequest,
  res: Response,
  next: NextFunction,
): Response<ScimError> | undefined {
  const acceptHeader = req.get("Accept");

  // Check if the Accept header specifies SCIM JSON
  if (acceptHeader && acceptHeader.includes("application/scim+json")) {
    res.setHeader("Content-Type", "application/scim+json");
  }

  try {
    if (!req.context.permissions.canManageTeam()) {
      req.context.permissions.throwPermissionError();
    }
  } catch (e) {
    return res.status(403).json({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      status: "403",
      detail: "You do not have permission to use SCIM.",
    });
  }

  if (!req.organization) {
    return res.status(400).json({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      status: "400",
      detail: "Organization is required but missing in the request.",
    });
  }

  if (!orgHasPremiumFeature(req.organization, "scim")) {
    return res.status(403).json({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      status: "403",
      detail: "SCIM requires an Enterprise GrowthBook License.",
    });
  }

  if (!usingOpenId()) {
    return res.status(403).json({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      status: "403",
      detail:
        "SCIM is not available for Growthbook organizations not using SSO.",
    });
  }

  next();
}
