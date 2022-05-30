import { IS_CLOUD, JWT_SECRET } from "../util/secrets";
import jwt from "express-jwt";
import jwks from "jwks-rsa";
import { NextFunction, Response } from "express";
import { AuthRequest } from "../types/AuthRequest";
import {
  markUserAsVerified,
  UserDocument,
  UserModel,
} from "../models/UserModel";
import {
  getDefaultPermissions,
  getOrganizationById,
  getPermissionsByRole,
  getRole,
  validateLogin,
} from "./organizations";
import { MemberRole } from "../../types/organization";
import { AuditInterface } from "../../types/audit";
import { insertAudit } from "./audit";
import { getUserByEmail, getUserById } from "./users";
import { hasOrganization } from "../models/OrganizationModel";

type JWTInfo = {
  email?: string;
  verified?: boolean;
  name?: string;
  method?: string;
};

// Self-hosted deployments use local auth
function getLocalJWTCheck() {
  if (!JWT_SECRET) {
    throw new Error("Must specify JWT_SECRET environment variable");
  }

  return jwt({
    secret: JWT_SECRET,
    audience: "https://api.growthbook.io",
    issuer: "https://api.growthbook.io",
    algorithms: ["HS256"],
  });
}
async function getUserFromLocalJWT(user: {
  sub: string;
}): Promise<UserDocument | null> {
  return getUserById(user.sub);
}

// Managed cloud deployment uses Auth0,
function getAuth0JWTCheck() {
  return jwt({
    secret: jwks.expressJwtSecret({
      cache: true,
      rateLimit: true,
      jwksRequestsPerMinute: 5,
      jwksUri: "https://growthbook.auth0.com/.well-known/jwks.json",
    }),
    audience: "https://api.growthbook.io",
    issuer: "https://growthbook.auth0.com/",
    algorithms: ["RS256"],
  });
}

async function getUserFromEmail(email: string): Promise<UserDocument | null> {
  if (!email) {
    throw new Error("Missing email address in authentication token");
  }
  return getUserByEmail(email);
}

function getInitialDataFromJWT(user: {
  ["https://growthbook.io/email"]?: string;
  ["https://growthbook.io/fname"]?: string;
  ["https://growthbook.io/verified"]?: boolean;
  sub?: string;
}): JWTInfo {
  if (!IS_CLOUD) {
    return {
      verified: false,
      method: "local",
    };
  }

  const sub = user["sub"] || "";
  const method = sub.split("|")[0] || "";
  return {
    email: user["https://growthbook.io/email"] || "",
    name: user["https://growthbook.io/fname"] || "",
    verified: user["https://growthbook.io/verified"] || false,
    method,
  };
}

export function getJWTCheck() {
  return IS_CLOUD ? getAuth0JWTCheck() : getLocalJWTCheck();
}

export async function processJWT(
  // eslint-disable-next-line
  req: AuthRequest & { user: any },
  res: Response,
  next: NextFunction
) {
  const { email, name, verified, method } = getInitialDataFromJWT(req.user);

  req.email = email || "";
  req.name = name || "";
  req.verified = verified || false;
  req.loginMethod = method || "";
  req.permissions = getDefaultPermissions();

  // Throw error if permissions don't pass
  req.checkPermissions = (...permissions) => {
    for (let i = 0; i < permissions.length; i++) {
      if (!req.permissions[permissions[i]]) {
        throw new Error("You do not have permission to complete that action.");
      }
    }
  };

  const user = await (IS_CLOUD
    ? getUserFromEmail(req.email)
    : getUserFromLocalJWT(req.user));

  if (user) {
    req.email = user.email;
    req.userId = user.id;
    req.name = user.name;
    req.admin = !!user.admin;

    if (IS_CLOUD && user.verified && !req.verified) {
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
          validateLogin(req, req.organization);
        } catch (e) {
          return res.status(403).json({
            status: 403,
            message: e.message,
          });
        }

        const role: MemberRole = req.admin
          ? "admin"
          : getRole(req.organization, user.id) || "collaborator";
        req.permissions = getPermissionsByRole(role);
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
