import { NextFunction, Request, Response } from "express";
import { SSO_CONFIG } from "enterprise";
import { logger } from "../../util/logger";
import { IS_CLOUD } from "../../util/secrets";
import { AuthRequest } from "../../types/AuthRequest";
import { markUserAsVerified, UserModel } from "../../models/UserModel";
import { getOrganizationById, validateLoginMethod } from "../organizations";
import { UserInterface } from "../../../types/user";
import { AuditInterface } from "../../../types/audit";
import { getUserByEmail } from "../users";
import { hasOrganization, updateMember } from "../../models/OrganizationModel";
import {
  IdTokenCookie,
  AuthChecksCookie,
  RefreshTokenCookie,
  SSOConnectionIdCookie,
} from "../../util/cookie";
import {
  EventAuditUserForResponseLocals,
  EventAuditUserLoggedIn,
} from "../../events/event-types";
import { insertAudit } from "../../models/AuditModel";
import { getTeamsForOrganization } from "../../models/TeamModel";
import { initializeLicenseForOrg } from "../licenseData";
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
  iat?: number;
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

  if (!usingOpenId() && user.minTokenDate && token.iat) {
    if (token.iat < Math.floor(user.minTokenDate.getTime() / 1000)) {
      throw new Error(
        "Your session has been revoked. Please refresh the page and login."
      );
    }
  }

  return user.toJSON<UserInterface>();
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
  res: Response<unknown, EventAuditUserForResponseLocals>,
  next: NextFunction
): Promise<void> {
  const { email, name, verified } = getInitialDataFromJWT(req.user);

  req.authSubject = req.user.sub || "";
  req.email = email || "";
  req.name = name || "";
  req.verified = verified || false;
  req.teams = [];

  const user = await getUserFromJWT(req.user);

  if (user) {
    req.email = user.email;
    req.userId = user.id;
    req.name = user.name;
    req.superAdmin = !!user.superAdmin;

    // If using default Cloud SSO (Auth0), once a user logs in with a verified email address,
    // require all future logins to be verified too.
    // This stops someone from creating an unverified email/password account and gaining access to
    // an account using "Login with Google"
    if (IS_CLOUD && !req.loginMethod?.id && user.verified && !req.verified) {
      res.status(406).json({
        status: 406,
        message: "You must log in via SSO to use GrowthBook",
      });
      return;
    }

    if (!user.verified && req.verified) {
      await markUserAsVerified(user.id);
    }

    if (req.headers["x-organization"]) {
      req.organization =
        (await getOrganizationById("" + req.headers["x-organization"])) ||
        undefined;

      if (req.organization) {
        if (
          !req.superAdmin &&
          !req.organization.members.filter((m) => m.id === req.userId).length
        ) {
          res.status(403).json({
            status: 403,
            message: "You do not have access to that organization",
          });
          return;
        }

        const memberRecord = req.organization.members.find(
          (m) => m.id === req.userId
        );
        if (memberRecord) {
          const lastLoginDate = memberRecord.lastLoginDate;
          const now = new Date();
          const interval = 1000 * 60 * 60 * 12; // 12 hr
          if (
            !lastLoginDate ||
            lastLoginDate.getTime() < now.getTime() - interval
          ) {
            try {
              await updateMember(req.organization, memberRecord.id, {
                lastLoginDate: now,
              });
            } catch (e) {
              logger.error("error updating last login date", {
                organization: req.organization.id,
                member: memberRecord.id,
                error: e,
              });
            }
          }
        }

        req.teams = await getTeamsForOrganization(req.organization.id);

        // Make sure this is a valid login method for the organization
        try {
          validateLoginMethod(req.organization, req);
        } catch (e) {
          res.status(403).json({
            status: 403,
            message: e.message,
          });
          return;
        }

        // init license for org if it exists
        await initializeLicenseForOrg(req.organization);
      } else {
        res.status(404).json({
          status: 404,
          message: "Organization not found",
        });
        return;
      }
    }

    const eventAudit: EventAuditUserLoggedIn = {
      type: "dashboard",
      id: user.id,
      email: user.email,
      name: user.name || "",
    };
    res.locals.eventAudit = eventAudit;

    req.audit = async (
      data: Omit<AuditInterface, "user" | "organization" | "dateCreated" | "id">
    ) => {
      await insertAudit({
        ...data,
        user: {
          id: user.id,
          email: user.email,
          name: user.name || "",
        },
        organization: req.organization?.id || "",
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
  if (password.length > 255) {
    throw new Error("Password must be less than 256 characters.");
  }

  return password;
}

export async function isNewInstallation() {
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

export function usingOpenId() {
  if (IS_CLOUD) return true;
  if (SSO_CONFIG) return true;
  return false;
}
