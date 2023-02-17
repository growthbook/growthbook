import { NextFunction, Request, Response } from "express";
import { IS_CLOUD, SSO_CONFIG } from "../../util/secrets";
import { AuthRequest } from "../../types/AuthRequest";
import { markUserAsVerified, UserModel } from "../../models/UserModel";
import {
  getOrganizationById,
  getRole,
  validateLoginMethod,
} from "../organizations";
import { Permission } from "../../../types/organization";
import { UserInterface } from "../../../types/user";
import { AuditInterface } from "../../../types/audit";
import { insertAudit } from "../audit";
import { getUserByEmail } from "../users";
import { hasOrganization } from "../../models/OrganizationModel";
import {
  IdTokenCookie,
  AuthChecksCookie,
  RefreshTokenCookie,
  SSOConnectionIdCookie,
} from "../../util/cookie";
import { getPermissionsByRole } from "../../util/organization.util";
import { AuthConnection } from "./AuthConnection";
import { OpenIdAuthConnection } from "./OpenIdAuthConnection";
import { LocalAuthConnection } from "./LocalAuthConnection";

type JWTInfo = {
  email?: string;
  verified?: boolean;
  name?: string;
};

type IdToken = {
  email?: string;
  email_verified?: boolean;
  given_name?: string;
  name?: string;
  sub?: string;
};

export function getAuthConnection(): AuthConnection {
  return usingOpenId() ? new OpenIdAuthConnection() : new LocalAuthConnection();
}

async function getUserFromJWT(token: IdToken): Promise<null | UserInterface> {
  if (!token.email) {
    throw new Error("Id token does not contain email address");
  }
  const user = await getUserByEmail(String(token.email));
  if (!user) return null;
  return user.toJSON();
}
function getInitialDataFromJWT(user: IdToken): JWTInfo {
  return {
    verified: user.email_verified || false,
    email: user.email || "",
    name: user.given_name || user.name || "",
  };
}

export async function processJWT(
  // eslint-disable-next-line
  req: AuthRequest & { user: IdToken },
  res: Response,
  next: NextFunction
) {
  const { email, name, verified } = getInitialDataFromJWT(req.user);

  req.authSubject = req.user.sub || "";
  req.email = email || "";
  req.name = name || "";
  req.verified = verified || false;

  const hasPermission = (
    permission: Permission,
    project?: string,
    envs?: string[]
  ): boolean => {
    if (!req.organization || !req.userId) {
      return false;
    }

    // Get the role based on the project (if specified)
    const projectRole = getRole(req.organization, req.userId, project);

    // Admin role always has permission
    if (req.admin || projectRole.role === "admin") return true;

    const permissions = getPermissionsByRole(
      projectRole.role,
      req.organization
    );

    // Missing permission
    if (!permissions.includes(permission)) {
      return false;
    }

    // If it's an environment-scoped permission and the user's role has limited access
    if (envs && projectRole.limitAccessByEnvironment) {
      for (let i = 0; i < envs.length; i++) {
        if (!projectRole.environments.includes(envs[i])) {
          return false;
        }
      }
    }

    // If it got through all the above checks, the user has permission
    return true;
  };

  // Throw error if permissions don't pass
  req.checkPermissions = (
    permission: Permission,
    project?: string | string[],
    envs?: string[] | Set<string>
  ) => {
    let checkProjects: (string | undefined)[];
    if (Array.isArray(project)) {
      checkProjects = project.length > 0 ? project : [undefined];
    } else {
      checkProjects = [project];
    }
    for (const p in checkProjects) {
      if (!hasPermission(permission, p, envs ? [...envs] : undefined)) {
        throw new Error("You do not have permission to complete that action.");
      }
    }
  };

  const user = await getUserFromJWT(req.user);

  if (user) {
    req.email = user.email;
    req.userId = user.id;
    req.name = user.name;
    req.admin = !!user.admin;

    // If using default Cloud SSO (Auth0), once a user logs in with a verified email address,
    // require all future logins to be verified too.
    // This stops someone from creating an unverified email/password account and gaining access to
    // an account using "Login with Google"
    if (IS_CLOUD && !req.loginMethod?.id && user.verified && !req.verified) {
      return res.status(406).json({
        status: 406,
        message: "You must verify your email address before using GrowthBook",
      });
    }

    if (!user.verified && req.verified) {
      await markUserAsVerified(user.id);
    }

    if (req.headers["x-organization"]) {
      req.organization =
        (await getOrganizationById("" + req.headers["x-organization"])) ||
        undefined;

      if (req.organization) {
        // Make sure member is part of the organization
        if (
          !req.admin &&
          !req.organization.members.filter((m) => m.id === req.userId).length
        ) {
          return res.status(403).json({
            status: 403,
            message: "You do not have access to that organization",
          });
        }

        // Make sure this is a valid login method for the organization
        try {
          validateLoginMethod(req.organization, req);
        } catch (e) {
          return res.status(403).json({
            status: 403,
            message: e.message,
          });
        }
      } else {
        return res.status(404).json({
          status: 404,
          message: "Organization not found",
        });
      }
    }

    req.audit = async (data: Partial<AuditInterface>) => {
      await insertAudit({
        ...data,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
        },
        organization: req.organization?.id,
        dateCreated: new Date(),
      });
    };
  } else {
    req.audit = async () => {
      throw new Error("No user in request");
    };
  }

  next();
}

export function deleteAuthCookies(req: Request, res: Response) {
  RefreshTokenCookie.setValue("", req, res);
  IdTokenCookie.setValue("", req, res);
  SSOConnectionIdCookie.setValue("", req, res);
  AuthChecksCookie.setValue("", req, res);
}

export function validatePasswordFormat(password?: string): string {
  if (!password) {
    throw new Error("Password cannot be empty");
  }
  if (password.length < 8) {
    throw new Error("Password must be at least 8 characters.");
  }

  return password;
}

async function checkNewInstallation() {
  const doc = await hasOrganization();
  if (doc) {
    return false;
  }

  const doc2 = await UserModel.findOne();
  if (doc2) {
    return false;
  }

  return true;
}

let newInstallationPromise: Promise<boolean>;
export function isNewInstallation() {
  if (!newInstallationPromise) {
    newInstallationPromise = checkNewInstallation();
  }
  return newInstallationPromise;
}
export function markInstalled() {
  newInstallationPromise = new Promise((resolve) => resolve(false));
}

export function usingOpenId() {
  if (IS_CLOUD) return true;
  if (SSO_CONFIG) return true;
  return false;
}
