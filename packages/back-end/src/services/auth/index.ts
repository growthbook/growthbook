import { NextFunction, Request, Response } from "express";
import { SSO_CONFIG } from "shared/enterprise";
import { ExpressCookieStickyBucketService } from "@growthbook/growthbook";
import { userHasPermission } from "shared/permissions";
import { AuditInterface } from "shared/types/audit";
import { Permission } from "shared/types/organization";
import { UserInterface } from "shared/types/user";
import {
  EventUserForResponseLocals,
  EventUserLoggedIn,
} from "shared/types/events/event-types";
import { logger } from "back-end/src/util/logger";
import { IS_CLOUD, IS_MULTI_ORG } from "back-end/src/util/secrets";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import {
  hasUser,
  markUserAsVerified,
  getUserByEmail,
} from "back-end/src/models/UserModel";
import {
  getOrganizationById,
  validateLoginMethod,
} from "back-end/src/services/organizations";
import {
  hasOrganization,
  updateMember,
} from "back-end/src/models/OrganizationModel";
import {
  IdTokenCookie,
  AuthChecksCookie,
  RefreshTokenCookie,
  SSOConnectionIdCookie,
} from "back-end/src/util/cookie";
import { getBuild } from "back-end/src/util/build";
import { usingFileConfig } from "back-end/src/init/config";
import { getUserPermissions } from "back-end/src/util/organization.util";
import { insertAudit } from "back-end/src/models/AuditModel";
import { getTeamsForOrganization } from "back-end/src/models/TeamModel";
import {
  getLicenseMetaData,
  getUserCodesForOrg,
} from "back-end/src/services/licenseData";
import { licenseInit, getAccountPlan } from "back-end/src/enterprise";
import { getGrowthBookClient } from "back-end/src/services/growthbook";
import { AuthConnection } from "./AuthConnection";
import { OpenIdAuthConnection } from "./OpenIdAuthConnection";
import { LocalAuthConnection } from "./LocalAuthConnection";

type JWTInfo = {
  email: string;
  verified: boolean;
  name: string;
  issuedAt?: number;
  sub?: string;
  vercelInstallationId?: string;
};

type IdToken = {
  email?: string;
  user_email?: string;
  email_verified?: boolean;
  given_name?: string;
  name?: string;
  user_name?: string;
  installation_id?: string;
  sub?: string;
  iat?: number;
};

export function getAuthConnection(): AuthConnection {
  return usingOpenId() ? new OpenIdAuthConnection() : new LocalAuthConnection();
}

async function getUserFromJWT(info: JWTInfo): Promise<null | UserInterface> {
  if (!info.email) {
    throw new Error("Id token does not contain email address");
  }
  const user = await getUserByEmail(String(info.email));
  if (!user) return null;

  if (!usingOpenId() && user.minTokenDate && info.issuedAt) {
    if (info.issuedAt < Math.floor(user.minTokenDate.getTime() / 1000)) {
      throw new Error(
        "Your session has been revoked. Please refresh the page and login.",
      );
    }
  }

  return user;
}
function getInitialDataFromJWT(user: IdToken): JWTInfo {
  // Vercel has special property names
  if ("iss" in user && user.iss === "https://marketplace.vercel.com") {
    return {
      verified: true,
      email: user["user_email"] || "",
      name: user["user_name"] || "",
      vercelInstallationId: user["installation_id"] || "",
      sub: user.sub,
    };
  }

  return {
    verified: user.email_verified || false,
    email: user.email || "",
    name: user.given_name || user.name || "",
    issuedAt: user.iat,
    sub: user.sub,
  };
}

export async function processJWT(
  // eslint-disable-next-line
  req: AuthRequest & { user: IdToken },
  res: Response<unknown, EventUserForResponseLocals>,
  next: NextFunction,
): Promise<void> {
  const parsedJWT = getInitialDataFromJWT(req.user);
  const { email, name, verified } = parsedJWT;

  req.authSubject = parsedJWT.sub || "";
  req.email = email || "";
  req.name = name || "";
  req.verified = verified || false;
  req.teams = [];
  req.currentUser = {
    id: "",
    email: email || "",
    superAdmin: false,
    verified: verified || false,
    name: name || "",
  };
  req.vercelInstallationId = parsedJWT.vercelInstallationId || "";

  req.checkPermissions = (
    permission: Permission,
    project?: string | string[],
    envs?: string[] | Set<string>,
  ) => {
    if (!req.userId || !req.organization) return false;

    const userPermissions = getUserPermissions(
      req.currentUser,
      req.organization,
      req.teams,
    );

    if (
      !userHasPermission(
        userPermissions,
        permission,
        project,
        envs ? [...envs] : undefined,
      )
    ) {
      throw new Error("You do not have permission to complete that action.");
    }
  };

  const user = await getUserFromJWT(parsedJWT);

  if (user) {
    req.currentUser = user;
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
          (m) => m.id === req.userId,
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
              logger.error(
                {
                  organization: req.organization.id,
                  member: memberRecord.id,
                  err: e,
                },
                "error updating last login date",
              );
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
        await licenseInit(
          req.organization,
          getUserCodesForOrg,
          getLicenseMetaData,
        );
      } else {
        res.status(404).json({
          status: 404,
          message: "Organization not found",
        });
        return;
      }
    }

    const eventAudit: EventUserLoggedIn = {
      type: "dashboard",
      id: user.id,
      email: user.email,
      name: user.name || "",
    };
    res.locals.eventAudit = eventAudit;

    req.audit = async (
      data: Omit<
        AuditInterface,
        "user" | "organization" | "dateCreated" | "id"
      >,
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

    if (IS_CLOUD) {
      const gbClient = getGrowthBookClient();

      if (gbClient) {
        const build = getBuild();

        // Create sticky bucket service for Express
        const stickyBucketService = new ExpressCookieStickyBucketService({
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          req: req as any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          res: res as any,
        });

        // Define user attributes
        const attributes = {
          id: user.id,
          url: req.originalUrl,
          cloud: IS_CLOUD,
          freeSeats: req.organization?.freeSeats,
          discountCode: req.organization?.discountCode,
          organizationId: req.organization?.id,
          accountPlan: req.organization
            ? getAccountPlan(req.organization)
            : undefined,
          superAdmin: user.superAdmin,
          orgDateCreated: req.organization?.dateCreated,
          anonymous_id: req.cookies["gb_device_id"],
          multiOrg: IS_MULTI_ORG,
          role: req.organization?.members.find((m) => m.id === user.id)?.role,
          hasLicenseKey: req.organization?.licenseKey ? true : false,
          configFile: usingFileConfig(),
          usingSSO: usingOpenId(),
          buildSHA: build.sha,
          buildDate: build.date,
          buildVersion: build.lastVersion,
        };

        try {
          // Apply sticky bucketing and get user context
          const userContext = await gbClient.applyStickyBuckets(
            {
              attributes,
              enableDevMode: true,
            },
            stickyBucketService,
          );

          // Create scoped instance for this request (reuses singleton)
          req.gb = gbClient.createScopedInstance(userContext);

          // Optional: Set tracking callback
          if (req.gb) {
            req.gb.setTrackingCallback(() => {
              // TODO: How to send event to Jitsu?
            });
          }
        } catch (error) {
          logger.error("Failed to create GrowthBook scoped instance", {
            error,
            userId: user.id,
          });
          // Continue without feature flags rather than failing request
        }
      }
    }
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
  if (await hasOrganization()) {
    return false;
  }
  if (await hasUser()) {
    return false;
  }

  return true;
}

export function usingOpenId() {
  if (IS_CLOUD) return true;
  if (SSO_CONFIG) return true;
  return false;
}
