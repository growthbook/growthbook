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
  createOrganization,
  hasOrganization,
} from "../models/OrganizationModel";
import { IS_CLOUD } from "../util/secrets";
import {
  isNewInstallation,
  markInstalled,
  validatePasswordFormat,
} from "../services/auth";
import { getEmailFromUserId, getOrgFromReq } from "../services/organizations";
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

export async function getHasOrganizations(req: Request, res: Response) {
  const hasOrg = IS_CLOUD ? true : await hasOrganization();
  return res.json({
    status: 200,
    hasOrganizations: hasOrg,
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

export async function postLogin(
  // eslint-disable-next-line
  req: Request<any, any, { email: string; password: string }>,
  res: Response
) {
  const { email, password } = req.body;

  validatePasswordFormat(password);

  const user = await getUserByEmail(email);
  if (!user) {
    console.log("Unknown email", email);
    return res.status(400).json({
      status: 400,
      message: "Invalid email or password",
    });
  }

  const valid = await verifyPassword(user, password);
  if (!valid) {
    console.log("Invalid password for", email);
    return res.status(400).json({
      status: 400,
      message: "Invalid email or password",
    });
  }

  return successResponse(req as Request, res, user.id);
}

export async function postLogout(req: Request, res: Response) {
  await deleteRefreshToken(req, res);

  res.status(200).json({
    status: 200,
  });
}

export async function postRegister(
  // eslint-disable-next-line
  req: Request<any, any, { email: string; name: string; password: string }>,
  res: Response
) {
  const { email, name, password } = req.body;

  validatePasswordFormat(password);

  // TODO: validate email and name

  const existingUser = await getUserByEmail(email);
  if (existingUser) {
    // Try to login to existing account
    const valid = await verifyPassword(existingUser, password);
    if (valid) {
      return successResponse(req as Request, res, existingUser.id);
    }

    return res.status(400).json({
      status: 400,
      message: "That email address is already registered.",
    });
  }

  // Create new account
  const user = await createUser(name, email, password);
  return successResponse(req as Request, res, user.id);
}

export async function postFirstTimeRegister(
  req: Request<
    // eslint-disable-next-line
    any,
    // eslint-disable-next-line
    any,
    {
      email: string;
      name: string;
      password: string;
      companyname: string;
    }
  >,
  res: Response
) {
  // Only allow this API endpoint when it's a brand-new installation with no users yet
  const newInstallation = await isNewInstallation();
  if (!newInstallation) {
    throw new Error(
      "An organization is already configured. Please refresh the page and try again."
    );
  }

  const { email, name, password, companyname } = req.body;

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

export async function postForgotPassword(
  // eslint-disable-next-line
  req: Request<any, any, { email: string }>,
  res: Response
) {
  const { email } = req.body;
  await createForgotPasswordToken(email);

  res.status(200).json({
    status: 200,
  });
}

export async function getResetPassword(
  req: Request<{ token: string }>,
  res: Response
) {
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

export async function postResetPassword(
  // eslint-disable-next-line
  req: Request<{ token: string }, any, { password: string }>,
  res: Response
) {
  const { token } = req.params;
  const { password } = req.body;

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

export async function postChangePassword(
  req: AuthRequest<{
    currentPassword: string;
    newPassword: string;
  }>,
  res: Response
) {
  const { currentPassword, newPassword } = req.body;
  const { userId } = getOrgFromReq(req);

  const user = await getUserById(userId);
  if (!user) {
    throw new Error("Invalid user");
  }

  const valid = await verifyPassword(user, currentPassword);
  if (!valid) {
    throw new Error("Current password is incorrect");
  }

  await updatePassword(user.id, newPassword);

  res.status(200).json({
    status: 200,
  });
}
