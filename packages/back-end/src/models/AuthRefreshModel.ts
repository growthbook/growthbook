import { Request, Response } from "express";
import mongoose from "mongoose";
import crypto from "crypto";
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

export async function createRefreshToken(
  req: Request,
  res: Response,
  user: UserInterface
) {
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

  res.cookie("AUTH_REFRESH_TOKEN", token, {
    httpOnly: true,
    maxAge: 30 * 24 * 60 * 60 * 1000,
    secure: req.secure,
  });
}

export async function deleteRefreshToken(req: Request, res: Response) {
  const refreshToken = req.cookies["AUTH_REFRESH_TOKEN"];
  if (refreshToken) {
    await AuthRefreshModel.deleteOne({
      token: refreshToken,
    });
  }

  res.clearCookie("AUTH_REFRESH_TOKEN");
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
