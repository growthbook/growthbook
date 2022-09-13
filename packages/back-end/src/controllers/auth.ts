import { Request, Response } from "express";
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
  getAuthConnection,
  IdTokenCookie,
  isNewInstallation,
  markInstalled,
  RefreshTokenCookie,
  SSOConnectionIdCookie,
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
import { getSSOConnectionByEmailDomain } from "../models/SSOConnectionModel";
import { UserInterface } from "../../types/user";

export async function getHasOrganizations(req: Request, res: Response) {
  const hasOrg = IS_CLOUD ? true : await hasOrganization();
  return res.json({
    status: 200,
    hasOrganizations: hasOrg,
  });
}

const auth = getAuthConnection();

export async function postRefresh(req: Request, res: Response) {
  // First try getting the idToken from cookies
  const idToken = IdTokenCookie.getValue(req);
  if (idToken) {
    return res.json({
      status: 200,
      token: idToken,
    });
  }

  // Then, try using a refreshToken
  try {
    const refreshToken = RefreshTokenCookie.getValue(req);
    if (!refreshToken) {
      throw new Error("Missing refresh token");
    }
    const {
      idToken,
      refreshToken: newRefreshToken,
      expiresIn,
    } = await auth.refresh(req, res, refreshToken);

    IdTokenCookie.setValue(idToken, req, res, expiresIn);
    if (newRefreshToken) {
      RefreshTokenCookie.setValue(newRefreshToken, req, res);
    }

    return res.json({
      status: 200,
      token: idToken,
    });
  } catch (e) {
    // Could not refresh
    const data = await auth.getUnauthenticatedResponse(req, res);
    return res.json({
      status: 200,
      ...data,
    });
  }
}

export async function postOAuthCallback(req: Request, res: Response) {
  const { idToken, refreshToken, expiresIn } = await auth.processCallback(
    req,
    res,
    null
  );

  if (!idToken) {
    throw new Error("Could not authenticate");
  }

  RefreshTokenCookie.setValue(refreshToken, req, res);
  IdTokenCookie.setValue(idToken, req, res, expiresIn);

  // TODO: better redirect location?
  return res.status(200).json({
    status: 200,
    redirectURI: "/",
  });
}

async function getLocalSuccessResponse(
  req: Request,
  res: Response,
  user: UserInterface
) {
  const { idToken, refreshToken, expiresIn } = await auth.processCallback(
    req,
    res,
    user
  );
  if (!idToken) {
    return res.status(400).json({
      status: 400,
      message: "Unable to create id token for user",
    });
  }

  IdTokenCookie.setValue(idToken, req, res, Math.max(600, expiresIn));
  RefreshTokenCookie.setValue(refreshToken, req, res);

  res.status(200).json({
    status: 200,
    token: idToken,
  });
}

export async function postLogoutSoft(req: Request, res: Response) {
  RefreshTokenCookie.setValue("", req, res);
  IdTokenCookie.setValue("", req, res);
  SSOConnectionIdCookie.setValue("", req, res);

  return res.status(200).json({
    status: 200,
  });
}

export async function postLogout(req: AuthRequest, res: Response) {
  const redirectURI = await auth.logout(req, res);
  RefreshTokenCookie.setValue("", req, res);
  IdTokenCookie.setValue("", req, res);

  return res.status(200).json({
    status: 200,
    redirectURI,
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

  getLocalSuccessResponse(req, res, user);
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
    if (!valid) {
      return res.status(400).json({
        status: 400,
        message: "That email address is already registered.",
      });
    }

    return getLocalSuccessResponse(req, res, existingUser);
  }

  // Create new account
  const user = await createUser(name, email, password);
  getLocalSuccessResponse(req, res, user);
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
      message: "An error occurred, please refresh the page and try again.",
    });
  }

  const user = await createUser(name, email, password);
  await createOrganization(email, user.id, companyname, "");
  markInstalled();

  getLocalSuccessResponse(req, res, user);
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

export async function getSSOConnectionFromDomain(req: Request, res: Response) {
  const { domain } = req.body;

  const sso = await getSSOConnectionByEmailDomain(domain as string);

  if (!sso?.id) {
    throw new Error(`Unknown SSO Connection for *@${domain}`);
  }

  SSOConnectionIdCookie.setValue(sso.id, req, res);

  return res.status(200).json({
    status: 200,
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
