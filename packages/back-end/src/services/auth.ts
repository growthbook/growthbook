import { IS_CLOUD, JWT_SECRET } from "../util/secrets";
import jwt from "express-jwt";
import jwks from "jwks-rsa";
import { NextFunction, Response } from "express";
import { AuthRequest } from "../types/AuthRequest";
import { UserDocument, UserModel } from "../models/UserModel";
import {
  getOrganizationById,
  getPermissionsByRole,
  getRole,
} from "./organizations";
import { MemberRole } from "../../types/organization";
import { AuditInterface } from "../../types/audit";
import { insertAudit } from "./audit";
import { getUserByEmail, getUserById } from "./users";
import { hasOrganization } from "../models/OrganizationModel";

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
}): Promise<UserDocument> {
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
async function getUserFromAuth0JWT(user: {
  "https://growthbook.io/email": string;
}): Promise<UserDocument> {
  return getUserByEmail(user["https://growthbook.io/email"]);
}

function getInitialEmailFromJWT(user: {
  ["https://growthbook.io/email"]?: string;
}) {
  if (IS_CLOUD) {
    return user["https://growthbook.io/email"] || "";
  }
  return "";
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
  req.email = getInitialEmailFromJWT(req.user);
  req.permissions = {};

  const user = await (IS_CLOUD
    ? getUserFromAuth0JWT(req.user)
    : getUserFromLocalJWT(req.user));

  if (user) {
    req.email = user.email;
    req.userId = user.id;
    req.name = user.name;
    req.admin = !!user.admin;

    if (req.headers["x-organization"]) {
      req.organization = await getOrganizationById(
        "" + req.headers["x-organization"]
      );

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

        const role: MemberRole = req.admin
          ? "admin"
          : getRole(req.organization, req.userId);
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
          id: req.userId,
          email: req.email,
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

export function validatePasswordFormat(password: string): void {
  if (password.length < 8) {
    throw new Error("Password must be at least 8 characters.");
  }
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

let newInstallationPromise: Promise<boolean> = null;
export function isNewInstallation() {
  if (!newInstallationPromise) {
    newInstallationPromise = checkNewInstallation();
  }
  return newInstallationPromise;
}
export function markInstalled() {
  newInstallationPromise = new Promise((resolve) => resolve(false));
}
