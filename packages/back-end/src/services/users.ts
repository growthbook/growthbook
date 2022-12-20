import crypto from "crypto";
import { promisify } from "util";
import uniqid from "uniqid";
import { UserDocument, UserModel } from "../models/UserModel";
import { usingOpenId, validatePasswordFormat } from "./auth";

const SALT_LEN = 16;
const HASH_LEN = 64;

const scrypt = promisify(crypto.scrypt);

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
