import { Request, Response, NextFunction } from "express";
import { ApiRequestLocals } from "../../types/api";
import { lookupOrganizationByApiKey } from "../models/ApiKeyModel";
import { insertAudit } from "../services/audit";
import { getOrganizationById, getRole } from "../services/organizations";
import { getCustomLogProps } from "../util/logger";
import { EventAuditUserApiKey } from "../events/event-types";
import { isApiKeyForUserInOrganization } from "../util/api-key.util";
import { OrganizationInterface, Permission } from "../../types/organization";
import { getPermissionsByRole } from "../util/organization.util";
import { ApiKeyInterface } from "../../types/apikey";

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

  // If using Basic scheme, need to base64 decode and extract the username
  const secretKey =
    scheme === "Basic"
      ? Buffer.from(value.trim(), "base64").toString("ascii").split(":")[0]
      : value.trim();

  // Lookup organization by secret key and store in req
  lookupOrganizationByApiKey(secretKey)
    .then(async (apiKeyPartial) => {
      const { organization, secret, id } = apiKeyPartial;
      if (!organization) {
        throw new Error("Invalid API key");
      }
      if (!secret) {
        throw new Error(
          "Must use a Secret API Key for this request, SDK Endpoint key given instead."
        );
      }
      req.apiKey = id || "";

      // Organization for key
      const org = await getOrganizationById(organization);
      if (!org) {
        throw new Error("Could not find organization attached to this API key");
      }
      req.organization = org;

      // If it's a user API key, verify that the user is part of the organization
      // This is important to check in the event that a user leaves an organization, the member list is updated, and the user's API keys are orphaned
      if (
        apiKeyPartial.type === "user" &&
        !isApiKeyForUserInOrganization(apiKeyPartial, org)
      ) {
        throw new Error("Could not find user attached to this API key");
      }

      // Check permissions for user API keys
      req.checkPermissions = async (permission: Permission) => {
        switch (apiKeyPartial.type) {
          case "read-only":
            // The `readonly` role is empty so it's not there
            throw new Error("read-only keys do not have this level of access");

          case "user":
            if (
              !(await doesUserHavePermission(permission, org, apiKeyPartial))
            ) {
              throw new Error(
                "API key user does not have this level of access"
              );
            }
            break;

          default:
            // secret API keys without a type are the full access API keys
            if (apiKeyPartial.secret !== true) {
              throw new Error("API key does not have this level of access");
            }
        }
      };

      // Add user info to logger
      res.log = req.log = req.log.child(getCustomLogProps(req as Request));

      const eventAudit: EventAuditUserApiKey = {
        type: "api_key",
        apiKey: id || "unknown",
      };
      req.eventAudit = eventAudit;

      // Add audit method to req
      req.audit = async (data) => {
        await insertAudit({
          ...data,
          user: {
            apiKey: req.apiKey,
          },
          organization: org.id,
          dateCreated: new Date(),
        });
      };

      // Continue to the actual request handler
      next();
    })
    .catch((e) => {
      res.status(401).json({
        message: e.message,
      });
    });
}

/**
 * Returns a list of permissions for the user
 * @param organization
 * @param userId
 */
async function getUserPermissions(
  organization: OrganizationInterface,
  userId: string | undefined
): Promise<Permission[]> {
  if (!userId) return [];

  try {
    const memberRoleInfo = await getRole(organization, userId);
    return getPermissionsByRole(memberRoleInfo.role, organization);
  } catch (e) {
    return [];
  }
}

async function doesUserHavePermission(
  permission: Permission,
  org: OrganizationInterface,
  apiKeyPartial: Partial<ApiKeyInterface>
): Promise<boolean> {
  try {
    const userPermissions = await getUserPermissions(org, apiKeyPartial.userId);
    return userPermissions.includes(permission);
  } catch (e) {
    return false;
  }
}
