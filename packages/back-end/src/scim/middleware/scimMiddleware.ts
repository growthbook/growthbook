import { Response, NextFunction } from "express";
import { AuthRequest } from "../../types/AuthRequest";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default function scimMiddleware(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  const acceptHeader = req.get("Accept");

  //TODO: Update how we determine this
  if (!process.env.SSO_CONFIG) {
    return res.status(500).json({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      status: "500",
      detail: "SCIM is not available for this GrowthBook organization.",
    });
  }
  if (!req.organization) {
    return res.status(400).json({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      status: "400",
      detail: "Organization is required but missing in the request.",
    });
  }

  // Check if the Accept header specifies SCIM JSON
  if (acceptHeader && acceptHeader.includes("application/scim+json")) {
    res.setHeader("Content-Type", "application/scim+json");
  }

  // Continue processing the request
  next();
}
