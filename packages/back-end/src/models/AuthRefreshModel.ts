import crypto from "crypto";
import { Request } from "express";
import mongoose from "mongoose";
import { UserInterface } from "../../types/user";

export interface AuthRefreshInterface {
  token: string;
  userId: string;
  userAgent: string;
  ip: string;
  createdAt: Date;
  lastLogin: Date;
}

const authRefreshSchema = new mongoose.Schema({
  token: {
    type: String,
    unique: true,
  },
  userId: String,
  userAgent: String,
  ip: String,
  createdAt: {
    type: Date,
    // Refresh is valid for 30 days
    expires: 30 * 24 * 60 * 60,
  },
  lastLogin: Date,
});

export type AuthRefreshDocument = mongoose.Document & AuthRefreshInterface;

export const AuthRefreshModel = mongoose.model<AuthRefreshDocument>(
  "AuthRefresh",
  authRefreshSchema
);

export async function createRefreshToken(req: Request, user: UserInterface) {
  const token = crypto.randomBytes(32).toString("base64");

  const authRefreshDoc: AuthRefreshInterface = {
    createdAt: new Date(),
    lastLogin: new Date(),
    userId: user.id,
    ip: req.ip,
    userAgent: req.headers["user-agent"] || "",
    token,
  };
  await AuthRefreshModel.create(authRefreshDoc);

  return token;
}

export async function getUserIdFromAuthRefreshToken(
  token: string
): Promise<string> {
  const doc = await AuthRefreshModel.findOne({
    token,
  });

  if (doc) {
    await AuthRefreshModel.updateOne(
      {
        _id: doc._id,
      },
      {
        $set: {
          lastLogin: new Date(),
        },
      }
    );
  }

  return doc?.userId || "";
}
