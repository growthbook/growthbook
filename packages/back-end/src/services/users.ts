import crypto from "crypto";
import { promisify } from "util";
import { Request } from "express";
import md5 from "md5";
import { UserInterface } from "back-end/types/user";
import {
  getAllUserEmailsAcrossAllOrgs,
  getUserByEmail,
  updateUser,
} from "back-end/src/models/UserModel";
import { findOrganizationsByMemberId } from "back-end/src/models/OrganizationModel";
import { createEventWithPayload } from "back-end/src/models/EventModel";
import { logger } from "back-end/src/util/logger";
import { IS_CLOUD } from "back-end/src/util/secrets";
import { UserLoginInterface } from "back-end/src/validators/users";
import { validatePasswordFormat } from "./auth";

const SALT_LEN = 16;
const HASH_LEN = 64;

const scrypt = promisify(crypto.scrypt);

// Generate unique codes for each user who is part of at least one organization
// by taking a porition of the hash of their email.
// This is used to identify seats being used of a license on self-serve.
// We base the code on their email so that the same user on multiple installations
// e.g. dev and production, will have the same code and be treated as a single seat.
export async function getUserLicenseCodes() {
  if (IS_CLOUD) {
    throw new Error("getUserLicenseCodes() is not supported in cloud");
  }

  const emails = await getAllUserEmailsAcrossAllOrgs();
  return Promise.all(
    emails.map(async (email) => {
      return md5(email).slice(0, 8);
    })
  );
}

export async function hash(password: string): Promise<string> {
  const salt = crypto.randomBytes(SALT_LEN).toString("hex");
  const derivedKey = await (scrypt(
    password,
    salt,
    HASH_LEN
  ) as Promise<Buffer>);
  return salt + ":" + derivedKey.toString("hex");
}

export async function verifyPassword(
  user: UserInterface,
  password: string
): Promise<boolean> {
  if (!user.passwordHash) return false;
  const [salt, key] = user.passwordHash.split(":");
  const keyBuffer = Buffer.from(key, "hex");
  const derivedKey = await (scrypt(
    password,
    salt,
    HASH_LEN
  ) as Promise<Buffer>);
  return crypto.timingSafeEqual(keyBuffer, derivedKey);
}

export async function updatePassword(userId: string, password: string) {
  validatePasswordFormat(password);
  const passwordHash = await hash(password);
  await updateUser(userId, { passwordHash });
}

/**
 * Some tracking properties exist on the request object
 * @param req
 */
export const getUserLoginPropertiesFromRequest = (
  req: Request
): Pick<UserLoginInterface, "userAgent" | "device" | "ip" | "os"> => {
  const userAgent = (req.headers["user-agent"] as string) || "";
  const device = (req.headers["sec-ch-ua"] as string) || "";
  const os = (req.headers["sec-ch-ua-platform"] as string) || "";
  const ip = req.ip || "";

  return {
    userAgent,
    device,
    os,
    ip,
  };
};

/**
 * Track a login event under each organization for a user that has just logged in.
 * @param email
 * @param device
 * @param userAgent
 * @param ip
 * @param os
 * @param userAgent
 */
export async function trackLoginForUser({
  email,
  device,
  userAgent,
  ip,
  os,
}: Pick<UserLoginInterface, "userAgent" | "device" | "ip" | "os"> & {
  email: string;
}): Promise<void> {
  const user = await getUserByEmail(email);
  if (!user) {
    return;
  }

  const organizations = await findOrganizationsByMemberId(user.id);
  if (!organizations) {
    return;
  }

  const organizationIds = organizations.map((org) => org.id);

  try {
    // Create a login event for all of a user's organizations
    const eventCreatePromises = organizationIds.map((organizationId) =>
      createEventWithPayload({
        payload: {
          object: "user",
          event: "user.login",
          user: {
            type: "dashboard",
            email: user.email,
            id: user.id,
            name: user.name || "",
          },
          data: {
            object: {
              email: user.email,
              id: user.id,
              name: user.name || "",
              ip,
              userAgent,
              os,
              device,
            },
          },
          projects: [],
          tags: [],
          environments: [],
          // The event contains the ip, userAgent, etc. of users
          // When marked as containing secrets, view access will be restricted to admins
          containsSecrets: true,
        },
        organizationId,
        objectId: user.id,
      })
    );
    await Promise.all(eventCreatePromises);
  } catch (e) {
    logger.error(e);
  }
}
