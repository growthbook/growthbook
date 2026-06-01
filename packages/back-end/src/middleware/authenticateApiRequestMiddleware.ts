import { Request, Response, NextFunction, RequestHandler } from "express";
import asyncHandler from "express-async-handler";
import { hasPermission } from "shared/permissions";
import {
  EventUserApiKey,
  EventUserLoggedIn,
} from "shared/types/events/event-types";
import { OrganizationInterface, Permission } from "shared/types/organization";
import { ApiKeyInterface, ApiKeyWithRole } from "shared/types/apikey";
import { TeamInterface } from "shared/types/team";
import { licenseInit } from "back-end/src/enterprise";
import { ApiRequestLocals } from "back-end/types/api";
import {
  getContextFromReq,
  getOrganizationById,
} from "back-end/src/services/organizations";
import { getCustomLogProps } from "back-end/src/util/logger";
import {
  isApiKeyForUserInOrganization,
  dangerousLookupOrganizationByApiKey,
} from "back-end/src/util/api-key.util";
import {
  getUserPermissions,
  getRolePermissions,
} from "back-end/src/util/organization.util";
import { getUserById } from "back-end/src/models/UserModel";
import {
  getLicenseMetaData,
  getUserCodesForOrg,
} from "back-end/src/services/licenseData";
import { ReqContextClass } from "back-end/src/services/context";
import { TeamModel } from "back-end/src/models/TeamModel";
import { ApiKeyModel } from "back-end/src/models/ApiKeyModel";
import { getAuthConnection, processJWT } from "back-end/src/services/auth";
import { AuthRequest } from "back-end/src/types/AuthRequest";

export default function authenticateApiRequestMiddleware(
  req: Request & ApiRequestLocals,
  res: Response & { log: Request["log"] },
  next: NextFunction,
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

  // Detect JWTs by their three-segment base64url shape. API keys are a single
  // opaque string, so this split is a cheap classifier.
  if (scheme === "Bearer" && value.trim().split(".").length === 3) {
    return authenticateWithJwt(req, res, next);
  }

  return authenticateWithApiKey(req, res, next, scheme, value);
}

function authenticateWithJwt(
  req: Request & ApiRequestLocals,
  res: Response & { log: Request["log"] },
  next: NextFunction,
) {
  const authReq = req as AuthRequest & ApiRequestLocals;
  const jwtMiddleware = getAuthConnection().middleware as RequestHandler;
  // Express's RequestHandler generics (ParamsDictionary) don't unify with
  // AuthRequest's `params: unknown` under stricter TS checkers (tsgo),
  // so launder through Request to keep the call signature happy.
  const reqAsExpress = req as Request;

  // Wrap processJWT with asyncHandler so any rejected promise from the async
  // middleware is forwarded to next(err) instead of becoming an unhandled
  // rejection that hangs the request. Mirrors how app.ts mounts processJWT.
  const wrappedProcessJWT = asyncHandler(
    processJWT as unknown as RequestHandler,
  );

  runMiddleware(jwtMiddleware, reqAsExpress, res)
    .then(() => {
      if (res.headersSent) return;
      return runMiddleware(wrappedProcessJWT, reqAsExpress, res);
    })
    .then(async () => {
      // processJWT may have responded (e.g. 403 for missing org access) —
      // skip the rest of the pipeline in that case.
      if (res.headersSent) return;

      const context = getContextFromReq(authReq);

      const eventAudit: EventUserLoggedIn = {
        type: "dashboard",
        id: authReq.userId || "",
        email: authReq.email || "",
        name: authReq.name || "",
      };

      req.apiKey = "";
      req.user = authReq.currentUser
        ? (await getUserById(authReq.currentUser.id)) || undefined
        : undefined;
      req.organization = context.org;
      req.eventAudit = eventAudit;
      req.audit = async (data) => {
        await context.auditLog(data);
      };
      req.context = context;
      req.isJwtAuth = true;

      // Permission checks for JWT requests mirror the internal-app behavior:
      // resolve the user's permissions from their org membership + teams.
      req.checkPermissions = (
        permission: Permission,
        project?: string | (string | undefined)[] | undefined,
        envs?: string[] | Set<string>,
      ) => {
        let checkProjects: (string | undefined)[];
        if (Array.isArray(project)) {
          checkProjects = project.length > 0 ? project : [undefined];
        } else {
          checkProjects = [project];
        }

        const userPermissions = getUserPermissions(
          {
            id: authReq.userId || "",
            superAdmin: authReq.superAdmin,
          },
          context.org,
          authReq.teams,
        );

        for (const p of checkProjects) {
          if (
            !hasPermission(
              userPermissions,
              permission,
              p,
              envs ? [...envs] : undefined,
            )
          ) {
            throw new Error(
              "You do not have permission to complete that action.",
            );
          }
        }
      };

      res.log = req.log = req.log.child(getCustomLogProps(req as Request));

      await licenseInit(context.org, getUserCodesForOrg, getLicenseMetaData);

      next();
    })
    .catch((e) => {
      if (res.headersSent) return;
      res.status(401).json({
        message: e.message || "Authentication failed",
      });
    });
}

function runMiddleware(
  middleware: RequestHandler,
  req: Request,
  res: Response,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (err?: unknown) => {
      if (settled) return;
      settled = true;
      if (err) reject(err);
      else resolve();
    };

    // Some middlewares respond and return without calling next (e.g. processJWT
    // sending a 403 for org-membership failures). Settle on response lifecycle
    // events too, so the promise — and the req/res/next closures it captures —
    // doesn't dangle.
    res.once("finish", () => settle());
    res.once("close", () => settle());

    middleware(req, res, (err) => settle(err));
  });
}

function authenticateWithApiKey(
  req: Request & ApiRequestLocals,
  res: Response & { log: Request["log"] },
  next: NextFunction,
  scheme: string,
  value: string,
) {
  const xOrganizationHeader = req.headers["x-organization"] as string;

  // If using Basic scheme, need to base64 decode and extract the username
  const secretKey =
    scheme === "Basic"
      ? Buffer.from(value.trim(), "base64").toString("ascii").split(":")[0]
      : value.trim();

  // Lookup organization by secret key and store in req
  dangerousLookupOrganizationByApiKey(secretKey)
    .then(async (apiKeyDoc) => {
      const { organization, secret, id, userId, role, disabled } = apiKeyDoc;
      if (!secret) {
        throw new Error(
          "Must use a Secret API Key for this request, SDK Endpoint key given instead.",
        );
      }
      // Record usage before the disabled check so operators deleting a disabled
      // key can see whether something out there is still trying to use it.
      ApiKeyModel.dangerousRecordUsageByKey(secretKey, organization).catch(
        (err) => {
          req.log.warn({ err, apiKeyId: id }, "Failed to record API key usage");
        },
      );
      if (disabled) {
        throw new Error("This API key has been disabled");
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
            "Only super admins can use the x-organization header",
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
            `Could not find organization from x-organization header: ${xOrganizationHeader}`,
          );
        } else {
          throw new Error(
            "Could not find organization attached to this API key",
          );
        }
      }
      req.organization = org;

      // If it's a user API key, verify that the user is part of the organization
      // This is important to check in the event that a user leaves an organization, the member list is updated, and the user's API keys are orphaned
      if (
        userId &&
        !req.user?.superAdmin &&
        !isApiKeyForUserInOrganization(apiKeyDoc, org)
      ) {
        throw new Error("Could not find user attached to this API key");
      }

      const teams = await TeamModel.dangerousGetTeamsForOrganization(org.id);

      const eventAudit: EventUserApiKey = {
        type: "api_key",
        apiKey: id || "unknown",
        ...(userId && req.user
          ? {
              id: req.user.id,
              name: req.user.name || "",
              email: req.user.email,
            }
          : {
              name: apiKeyDoc.description || "",
            }),
      };

      req.context = new ReqContextClass({
        org,
        auditUser: eventAudit,
        teams,
        user: req.user,
        role: role,
        apiKey: id,
        apiKeyData: apiKeyDoc,
        req,
      });

      // Check permissions for user API keys
      req.checkPermissions = (
        permission: Permission,
        project?: string | (string | undefined)[] | undefined,
        envs?: string[] | Set<string>,
      ) => {
        let checkProjects: (string | undefined)[];
        if (Array.isArray(project)) {
          checkProjects = project.length > 0 ? project : [undefined];
        } else {
          checkProjects = [project];
        }

        for (const p of checkProjects) {
          verifyApiKeyPermission({
            apiKey: apiKeyDoc,
            permission,
            organization: org,
            project: p,
            environments: envs ? [...envs] : undefined,
            teams,
            superAdmin: req.user?.superAdmin,
          });
        }
      };

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

function doesUserHavePermission(
  org: OrganizationInterface,
  permission: Permission,
  apiKeyDoc: ApiKeyInterface,
  teams: TeamInterface[],
  superAdmin: boolean | undefined,
  project?: string,
  envs?: string[],
): boolean {
  try {
    const userId = apiKeyDoc.userId;
    if (!userId) {
      return false;
    }

    // Generate full list of permissions for the user
    const userPermissions = getUserPermissions(
      { id: userId, superAdmin },
      org,
      teams,
    );

    // Check if the user has the permission
    return hasPermission(userPermissions, permission, project, envs);
  } catch (e) {
    return false;
  }
}

type VerifyApiKeyPermissionOptions = {
  apiKey: ApiKeyInterface;
  permission: Permission;
  organization: OrganizationInterface;
  project?: string;
  environments?: string[];
  teams: TeamInterface[];
  superAdmin: boolean | undefined;
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
  superAdmin,
}: VerifyApiKeyPermissionOptions) {
  if (apiKey.userId) {
    if (
      !doesUserHavePermission(
        organization,
        permission,
        apiKey,
        teams,
        superAdmin,
        project,
        environments,
      )
    ) {
      throw new Error("API key user does not have this level of access");
    }

    if (apiKey.secret !== true) {
      throw new Error("API key does not have this level of access");
    }
  } else if (apiKey.secret && apiKey.role) {
    const apiKeyPermissions = getRolePermissions(
      apiKey as ApiKeyWithRole,
      organization,
      teams,
    );

    if (!hasPermission(apiKeyPermissions, permission, project, environments)) {
      throw new Error("API key user does not have this level of access");
    }
  } else {
    // This shouldn't happen (old SDK key with secret === false being used)
    throw new Error("API key does not have this level of access");
  }
}
