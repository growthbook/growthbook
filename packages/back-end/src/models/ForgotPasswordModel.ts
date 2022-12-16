import crypto from "crypto";
import mongoose from "mongoose";
import { getUserByEmail } from "../services/users";
import { APP_ORIGIN } from "../util/secrets";
import { isEmailEnabled, sendResetPasswordEmail } from "../services/email";
import { logger } from "../util/logger";

export interface ForgotPasswordInterface {
  token: string;
  userId: string;
  createdAt: Date;
}

const forgotPasswordSchema = new mongoose.Schema({
  token: {
    type: String,
    unique: true,
  },
  userId: String,
  createdAt: {
    type: Date,
    // Link is valid for 30 minutes
    expires: 30 * 60,
  },
});

export type ForgotPasswordDocument = mongoose.Document &
  ForgotPasswordInterface;

export const ForgotPasswordModel = mongoose.model<ForgotPasswordDocument>(
  "ForgotPassword",
  forgotPasswordSchema
);

export async function createForgotPasswordToken(email: string): Promise<void> {
  const user = await getUserByEmail(email);
  if (!user) {
    throw new Error("Could not find a user with that email address");
  }

  const token = crypto.randomBytes(32).toString("hex");
  const doc: ForgotPasswordInterface = {
    userId: user.id,
    token,
    createdAt: new Date(),
  };
  await ForgotPasswordModel.create(doc);

  const resetUrl = `${APP_ORIGIN}/reset-password?token=${token}`;

  try {
    if (!isEmailEnabled()) {
      throw new Error(
        "Email server not configured. Check server logs for reset link."
      );
    }

    await sendResetPasswordEmail(email, resetUrl);
  } catch (e) {
    logger.info("The reset password link for " + email + " is: " + resetUrl);
    throw e;
  }
}

export async function getUserIdFromForgotPasswordToken(
  token: string
): Promise<string> {
  const doc = await ForgotPasswordModel.findOne({
    token,
  });

  return doc?.userId || "";
}

export async function deleteForgotPasswordToken(token: string) {
  return ForgotPasswordModel.deleteOne({
    token,
  });
}
