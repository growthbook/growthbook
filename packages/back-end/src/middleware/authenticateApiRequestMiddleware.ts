import { Request, Response, NextFunction } from "express";
import { licenseInit } from "enterprise";
import { ApiRequestLocals } from "../../types/api";
import { lookupOrganizationByApiKey } from "../models/ApiKeyModel";
import { getOrganizationById } from "../services/organizations";
import { getCustomLogProps } from "../util/logger";
import { EventAuditUserApiKey } from "../events/event-types";
import { isApiKeyForUserInOrganization } from "../util/api-key.util";
import { getTeamsForOrganization } from "../models/TeamModel";
import { getUserById } from "../services/users";
import {
  getLicenseMetaData,
  getUserCodesForOrg,
} from "../services/licenseData";
import { ReqContextClass } from "../services/context";

export default function authenticateApiRequestMiddleware(
  req: Request & ApiRequestLocals,
  res: Response & { log: Request["log"] },
  next: NextFunction
) {
  // Get secret key from Authorization header and store in req
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(400).json({
      message: "Missing Authorization header",
    });
  }

  const [scheme, value] = authHeader.split(" ");
  if (scheme !== "Bearer" && scheme !== "Basic") {
    return res.status(400).json({
      message: "Must use either a Bearer or Basic authentication scheme",
    });
  }

  if (!value) {
    return res.status(400).json({
      message: "Missing API key in Authorization header",
    });
  }

  const xOrganizationHeader = req.headers["x-organization"] as string;

  // If using Basic scheme, need to base64 decode and extract the username
  const secretKey =
    scheme === "Basic"
      ? Buffer.from(value.trim(), "base64").toString("ascii").split(":")[0]
      : value.trim();

  // Lookup organization by secret key and store in req
  lookupOrganizationByApiKey(secretKey)
    .then(async (apiKeyPartial) => {
      const { organization, secret, id, userId, role } = apiKeyPartial;
      if (!organization) {
        throw new Error("Invalid API key");
      }
      if (!secret) {
        throw new Error(
          "Must use a Secret API Key for this request, SDK Endpoint key given instead."
        );
      }
      req.apiKey = id || "";

      // If it's a personal access token API key, store the user ID in req
      if (userId) {
        req.user = (await getUserById(userId)) || undefined;
        if (!req.user) {
          throw new Error("Could not find user attached to this API key");
        }
      }

      let asOrg = organization;
      if (xOrganizationHeader) {
        if (!req.user?.superAdmin) {
          throw new Error(
            "Only super admins can use the x-organization header"
          );
        } else {
          asOrg = xOrganizationHeader;
        }
      }

      // Organization for key
      const org = await getOrganizationById(asOrg);
      if (!org) {
        if (xOrganizationHeader) {
          throw new Error(
            `Could not find organization from x-organization header: ${xOrganizationHeader}`
          );
        } else {
          throw new Error(
            "Could not find organization attached to this API key"
          );
        }
      }
      req.organization = org;

      // If it's a user API key, verify that the user is part of the organization
      // This is important to check in the event that a user leaves an organization, the member list is updated, and the user's API keys are orphaned
      if (
        userId &&
        !req.user?.superAdmin &&
        !isApiKeyForUserInOrganization(apiKeyPartial, org)
      ) {
        throw new Error("Could not find user attached to this API key");
      }

      const teams = await getTeamsForOrganization(org.id);

      const eventAudit: EventAuditUserApiKey = {
        type: "api_key",
        apiKey: id || "unknown",
      };

      req.context = new ReqContextClass({
        org,
        auditUser: eventAudit,
        teams,
        user: req.user,
        role: role,
        apiKey: id,
        req,
      });

      // Add user info to logger
      res.log = req.log = req.log.child(getCustomLogProps(req as Request));

      req.eventAudit = eventAudit;

      // Add audit method to req
      req.audit = async (data) => {
        await req.context.auditLog(data);
      };

      // init license for org if it exists
      await licenseInit(org, getUserCodesForOrg, getLicenseMetaData);

      // Continue to the actual request handler
      next();
    })
    .catch((e) => {
      res.status(401).json({
        message: e.message,
      });
    });
}
