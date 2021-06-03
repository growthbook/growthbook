import { Request, Response } from "express";
import jwt from "jsonwebtoken";
import {
  createRefreshToken,
  deleteRefreshToken,
  getUserIdFromAuthRefreshToken,
} from "../models/AuthRefreshModel";
import {
  createForgotPasswordToken,
  deleteForgotPasswordToken,
  getUserIdFromForgotPasswordToken,
} from "../models/ForgotPasswordModel";
import {
  isNewInstallation,
  markInstalled,
  validatePasswordFormat,
} from "../services/auth";
import {
  createOrganization,
  getEmailFromUserId,
} from "../services/organizations";
import {
  createUser,
  getUserByEmail,
  getUserById,
  updatePassword,
  verifyPassword,
} from "../services/users";
import { AuthRequest } from "../types/AuthRequest";
import { JWT_SECRET } from "../util/secrets";

function generateJWT(userId: string) {
  return jwt.sign(
    {
      scope: "profile openid email",
    },
    JWT_SECRET,
    {
      algorithm: "HS256",
      audience: "https://api.growthbook.io",
      issuer: "https://api.growthbook.io",
      subject: userId,
      // 30 minutes
      expiresIn: 1800,
    }
  );
}

async function successResponse(req: Request, res: Response, userId: string) {
  const token = generateJWT(userId);

  // Create a refresh token
  await createRefreshToken(req, res, userId);

  return res.status(200).json({
    status: 200,
    token,
  });
}

export async function postRefresh(req: Request, res: Response) {
  // Look for refresh token header
  const refreshToken = req.cookies["AUTH_REFRESH_TOKEN"];
  if (!refreshToken) {
    const newInstallation = await isNewInstallation();

    return res.json({
      status: 200,
      authenticated: false,
      newInstallation,
    });
  }

  const userId = await getUserIdFromAuthRefreshToken(refreshToken);
  if (!userId) {
    return res.json({
      status: 200,
      authenticated: false,
    });
  }

  const user = await getUserById(userId);

  const token = generateJWT(userId);
  return res.json({
    status: 200,
    authenticated: true,
    token,
    email: user?.email || "",
  });
}

export async function postLogin(req: Request, res: Response) {
  const { email, password }: { email: string; password: string } = req.body;

  validatePasswordFormat(password);

  const user = await getUserByEmail(email);
  if (!user) {
    return res.status(400).json({
      status: 400,
      message: "Could not find account with that email address",
    });
  }

  const valid = verifyPassword(user, password);
  if (!valid) {
    return res.status(400).json({
      status: 400,
      message: "Invalid password",
    });
  }

  return successResponse(req, res, user.id);
}

export async function postLogout(req: Request, res: Response) {
  await deleteRefreshToken(req, res);

  res.status(200).json({
    status: 200,
  });
}

export async function postRegister(req: Request, res: Response) {
  const {
    email,
    name,
    password,
  }: { email: string; name: string; password: string } = req.body;

  validatePasswordFormat(password);

  // TODO: validate email and name

  const existingUser = await getUserByEmail(email);
  if (existingUser) {
    // Try to login to existing account
    const valid = verifyPassword(existingUser, password);
    if (valid) {
      return successResponse(req, res, existingUser.id);
    }

    return res.status(400).json({
      status: 400,
      message: "That email address is already registered.",
    });
  }

  // Create new account
  const user = await createUser(name, email, password);
  return successResponse(req, res, user.id);
}

export async function postFirstTimeRegister(req: Request, res: Response) {
  const {
    email,
    name,
    password,
    companyname,
  }: {
    email: string;
    name: string;
    password: string;
    companyname: string;
  } = req.body;

  validatePasswordFormat(password);
  if (companyname.length < 3) {
    throw Error("Company length must be at least 3 characters");
  }

  const existingUser = await getUserByEmail(email);
  if (existingUser) {
    return res.status(400).json({
      status: 400,
      message: "An error ocurred, please refresh the page and try again.",
    });
  }

  const user = await createUser(name, email, password);
  await createOrganization(email, user.id, companyname, "");
  markInstalled();
  return successResponse(req, res, user.id);
}

export async function postForgotPassword(req: Request, res: Response) {
  const { email }: { email: string } = req.body;
  await createForgotPasswordToken(email);

  res.status(200).json({
    status: 200,
  });
}

export async function getResetPassword(req: Request, res: Response) {
  const { token } = req.params;
  if (!token) {
    throw new Error("Invalid password reset token.");
  }

  const userId = await getUserIdFromForgotPasswordToken(token);

  if (!userId) {
    throw new Error("Invalid password reset token.");
  }

  const email = await getEmailFromUserId(userId);
  if (!email) {
    throw new Error("Could not find user for that password reset token.");
  }

  res.status(200).json({
    status: 200,
    email,
  });
}

export async function postResetPassword(req: Request, res: Response) {
  const { token } = req.params;
  const { password }: { password: string } = req.body;

  if (!token) {
    throw new Error("Invalid password reset token.");
  }

  const userId = await getUserIdFromForgotPasswordToken(token);

  if (!userId) {
    throw new Error("Invalid password reset token.");
  }

  const email = await getEmailFromUserId(userId);
  if (!email) {
    throw new Error("Could not find user for that password reset token.");
  }

  await updatePassword(userId, password);
  await deleteForgotPasswordToken(token);

  res.status(200).json({
    status: 200,
    email,
  });
}

export async function postChangePassword(req: AuthRequest, res: Response) {
  const {
    currentPassword,
    newPassword,
  }: {
    currentPassword: string;
    newPassword: string;
  } = req.body;

  const user = await getUserById(req.userId);

  const valid = await verifyPassword(user, currentPassword);
  if (!valid) {
    throw new Error("Current password is incorrect");
  }

  await updatePassword(user.id, newPassword);

  res.status(200).json({
    status: 200,
  });
}
