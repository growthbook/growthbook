import { Request, Response, NextFunction } from "express";
import { ApiRequestLocals } from "../../types/api";
import { lookupOrganizationByApiKey } from "../models/ApiKeyModel";
import { getOrganizationById, getRole } from "../services/organizations";
import { getCustomLogProps } from "../util/logger";
import { EventAuditUserApiKey } from "../events/event-types";
import { isApiKeyForUserInOrganization } from "../util/api-key.util";
import {
  MemberRole,
  OrganizationInterface,
  Permission,
} from "../../types/organization";
import { getPermissionsByRole } from "../util/organization.util";
import { ApiKeyInterface } from "../../types/apikey";
import { insertAudit } from "../models/AuditModel";

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
        apiKeyPartial.userId &&
        !isApiKeyForUserInOrganization(apiKeyPartial, org)
      ) {
        throw new Error("Could not find user attached to this API key");
      }

      // Check permissions for user API keys
      req.checkPermissions = (
        permission: Permission,
        project?: string | (string | undefined)[] | undefined,
        envs?: string[] | Set<string>
      ) => {
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
 * this is a duplication of the logic in processJwt() -> hasPermission()
 */
function doesUserHavePermission(
  org: OrganizationInterface,
  permission: Permission,
  apiKeyPartial: Partial<ApiKeyInterface>,
  project?: string,
  envs?: string[]
): boolean {
  try {
    const userId = apiKeyPartial.userId;
    if (!userId) {
      return false;
    }

    const memberRoleInfo = getRole(org, userId, project);
    const userPermissions = getPermissionsByRole(memberRoleInfo.role, org);
    if (!userPermissions.includes(permission)) {
      return false;
    }

    // If it's an environment-scoped permission and the user's role has limited access
    if (envs && memberRoleInfo.limitAccessByEnvironment) {
      for (let i = 0; i < envs.length; i++) {
        if (!memberRoleInfo.environments.includes(envs[i])) {
          return false;
        }
      }
    }

    // If it got through all the above checks, the user has permission
    return true;
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
}: VerifyApiKeyPermissionOptions) {
  if (apiKey.userId) {
    if (
      !doesUserHavePermission(
        organization,
        permission,
        apiKey,
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
    const rolePermissions = getPermissionsByRole(
      apiKey.role as MemberRole,
      organization
    );

    // No need to treat "readonly" differently, it will return an empty array permissions array and fail this check
    if (!rolePermissions.includes(permission)) {
      throw new Error("API key user does not have this level of access");
    }
  } else {
    // This shouldn't happen (old SDK key with secret === false being used)
    throw new Error("API key does not have this level of access");
  }
}
