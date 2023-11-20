import { Request, Response, NextFunction } from "express";
import { licenseInit } from "enterprise";
import { hasPermission } from "shared/permissions";
import { ApiRequestLocals } from "../../types/api";
import { lookupOrganizationByApiKey } from "../models/ApiKeyModel";
import { getOrganizationById } from "../services/organizations";
import { getCustomLogProps } from "../util/logger";
import { EventAuditUserApiKey } from "../events/event-types";
import { isApiKeyForUserInOrganization } from "../util/api-key.util";
import {
  MemberRole,
  OrganizationInterface,
  Permission,
} from "../../types/organization";
import {
  getUserPermissions,
  roleToPermissionMap,
} from "../util/organization.util";
import { ApiKeyInterface } from "../../types/apikey";
import { insertAudit } from "../models/AuditModel";
import { getTeamsForOrganization } from "../models/TeamModel";
import { TeamInterface } from "../../types/team";
import { getUserById } from "../services/users";

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
      const { organization, secret, id, userId } = apiKeyPartial;
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

      // Check permissions for user API keys
      req.checkPermissions = (
        permission: Permission,
        project?: string | (string | undefined)[] | undefined,
        envs?: string[] | Set<string>
      ) => {
        // Super admins have full access to every organization
        if (req.user?.superAdmin) {
          return;
        }
        let checkProjects: (string | undefined)[];
        if (Array.isArray(project)) {
          checkProjects = project.length > 0 ? project : [undefined];
        } else {
          checkProjects = [project];
        }

        for (const p of checkProjects) {
          verifyApiKeyPermission({
            apiKey: apiKeyPartial,
            permission,
            organization: org,
            project: p,
            environments: envs ? [...envs] : undefined,
            teams,
          });
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

      // init license for org if it exists
      await licenseInit(req.organization.licenseKey);

      // Continue to the actual request handler
      next();
    })
    .catch((e) => {
      res.status(401).json({
        message: e.message,
      });
    });
}

function doesUserHavePermission(
  org: OrganizationInterface,
  permission: Permission,
  apiKeyPartial: Partial<ApiKeyInterface>,
  teams: TeamInterface[],
  project?: string,
  envs?: string[]
): boolean {
  try {
    const userId = apiKeyPartial.userId;
    if (!userId) {
      return false;
    }

    // Generate full list of permissions for the user
    const userPermissions = getUserPermissions(userId, org, teams);

    // Check if the user has the permission
    return hasPermission(userPermissions, permission, project, envs);
  } catch (e) {
    return false;
  }
}

type VerifyApiKeyPermissionOptions = {
  apiKey: Partial<ApiKeyInterface>;
  permission: Permission;
  organization: OrganizationInterface;
  project?: string;
  environments?: string[];
  teams: TeamInterface[];
};

/**
 * @param apiKey
 * @param permission
 * @param envs
 * @param project
 * @throws an error if there are no permissions
 */
export function verifyApiKeyPermission({
  apiKey,
  permission,
  organization,
  environments,
  project,
  teams,
}: VerifyApiKeyPermissionOptions) {
  if (apiKey.userId) {
    if (
      !doesUserHavePermission(
        organization,
        permission,
        apiKey,
        teams,
        project,
        environments
      )
    ) {
      throw new Error("API key user does not have this level of access");
    }

    if (apiKey.secret !== true) {
      throw new Error("API key does not have this level of access");
    }
  } else if (apiKey.secret && apiKey.role) {
    // Because of the JIT migration, `role` will always be set here, even for old secret keys
    // This will check a valid role is provided.
    const rolePermissions = roleToPermissionMap(
      apiKey.role as MemberRole,
      organization
    );

    // No need to treat "readonly" differently, it will return an empty array permissions array and fail this check
    if (!rolePermissions[permission]) {
      throw new Error("API key user does not have this level of access");
    }
  } else {
    // This shouldn't happen (old SDK key with secret === false being used)
    throw new Error("API key does not have this level of access");
  }
}
