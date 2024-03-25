import crypto from "crypto";
import { promisify } from "util";
import uniqid from "uniqid";
import { Request } from "express";
import md5 from "md5";
import { UserDocument, UserModel } from "../models/UserModel";
import { findOrganizationsByMemberId } from "../models/OrganizationModel";
import { UserLoginNotificationEvent } from "../events/notification-events";
import { createEvent } from "../models/EventModel";
import { UserLoginAuditableProperties } from "../events/event-types";
import { logger } from "../util/logger";
import { IS_CLOUD } from "../util/secrets";
import { usingOpenId, validatePasswordFormat } from "./auth";

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

  const users = await UserModel.aggregate([
    {
      $lookup: {
        from: "organizations",
        localField: "id",
        foreignField: "members.id",
        as: "orgs",
      },
    },
    {
      $match: {
        "orgs.0": { $exists: true },
      },
    },
  ]);

  return Promise.all(
    users.map(async (user) => {
      return md5(user.email).slice(0, 8);
    })
  );
}

export async function getUserByEmail(email: string) {
  return UserModel.findOne({
    email,
  });
}

export async function getUserById(id: string) {
  return UserModel.findOne({
    id,
  });
}

export async function getUsersByIds(ids: string[]) {
  return UserModel.find({
    id: { $in: ids },
  });
}

async function hash(password: string): Promise<string> {
  const salt = crypto.randomBytes(SALT_LEN).toString("hex");
  const derivedKey = await (scrypt(
    password,
    salt,
    HASH_LEN
  ) as Promise<Buffer>);
  return salt + ":" + derivedKey.toString("hex");
}

export async function verifyPassword(
  user: UserDocument,
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

  await UserModel.updateOne(
    {
      id: userId,
    },
    {
      $set: {
        passwordHash,
      },
    }
  );
}

export async function createUser(
  name: string,
  email: string,
  password?: string,
  verified: boolean = false
) {
  let passwordHash = "";

  if (!usingOpenId()) {
    password = validatePasswordFormat(password);
    passwordHash = await hash(password);
  }

  return UserModel.create({
    name,
    email,
    passwordHash,
    id: uniqid("u_"),
    verified,
  });
}

/**
 * Some tracking properties exist on the request object
 * @param req
 */
export const getAuditableUserPropertiesFromRequest = (
  req: Request
): Pick<UserLoginAuditableProperties, "userAgent" | "device" | "ip" | "os"> => {
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
}: Pick<UserLoginAuditableProperties, "userAgent" | "device" | "ip" | "os"> & {
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

  const auditedData: UserLoginAuditableProperties = {
    email: user.email,
    id: user.id,
    name: user.name || "",
    ip,
    userAgent,
    os,
    device,
  };

  const event: UserLoginNotificationEvent = {
    object: "user",
    event: "user.login",
    user: {
      type: "dashboard",
      email: user.email,
      id: user.id,
      name: user.name || "",
    },
    data: {
      current: auditedData,
    },
  };

  try {
    // Create a login event for all of a user's organizations
    const eventCreatePromises = organizationIds.map((organizationId) =>
      createEvent(organizationId, event)
    );
    await Promise.all(eventCreatePromises);
  } catch (e) {
    logger.error(e);
  }
}
