import { Request, Response } from "express";
import { UserInterface } from "shared/types/user";
import {
  createForgotPasswordToken,
  deleteForgotPasswordToken,
  getUserIdFromForgotPasswordToken,
} from "back-end/src/models/ForgotPasswordModel";
import {
  createOrganization,
  hasOrganization,
} from "back-end/src/models/OrganizationModel";
import { IS_CLOUD } from "back-end/src/util/secrets";
import {
  deleteAuthCookies,
  getAuthConnection,
  isNewInstallation,
  validatePasswordFormat,
} from "back-end/src/services/auth";
import {
  IdTokenCookie,
  RefreshTokenCookie,
  SSOConnectionIdCookie,
} from "back-end/src/util/cookie";
import {
  getContextForAgendaJobByOrgObject,
  getContextFromReq,
} from "back-end/src/services/organizations";
import { updatePassword, verifyPassword } from "back-end/src/services/users";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { _dangerousGetSSOConnectionByEmailDomain } from "back-end/src/models/SSOConnectionModel";
import {
  resetMinTokenDate,
  getEmailFromUserId,
  createUser,
  getUserByEmail,
  getUserById,
} from "back-end/src/models/UserModel";
import { AuthRefreshModel } from "back-end/src/models/AuthRefreshModel";

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
  try {
    const { idToken, refreshToken, expiresIn } = await auth.processCallback(
      req,
      res,
      null,
    );

    if (!idToken) {
      throw new Error("Could not authenticate");
    }

    RefreshTokenCookie.setValue(refreshToken, req, res);
    IdTokenCookie.setValue(idToken, req, res, expiresIn);

    return res.status(200).json({
      status: 200,
    });
  } catch (e) {
    req.log.error(e, "Error signing in");
    return res.status(400).json({
      status: 400,
      message: "Error Signing In",
    });
  }
}

export async function setResponseCookies(
  req: Request,
  res: Response,
  user: UserInterface,
) {
  const { idToken, refreshToken, expiresIn } = await auth.processCallback(
    req,
    res,
    user,
  );

  if (!idToken) {
    return res.status(400).json({
      status: 400,
      message: "Unable to create id token for user",
    });
  }

  IdTokenCookie.setValue(
    idToken,
    req,
    res,
    Math.max(10 * 60 * 1000, expiresIn),
  );
  RefreshTokenCookie.setValue(refreshToken, req, res);

  return idToken;
}

export async function sendLocalSuccessResponse(
  req: Request,
  res: Response,
  user: UserInterface,
  projectId?: string,
) {
  const idToken = await setResponseCookies(req, res, user);

  res.status(200).json({
    status: 200,
    token: idToken,
    projectId,
  });
}

export async function postLogout(req: Request, res: Response) {
  let redirectURI = "";
  try {
    redirectURI = await auth.logout(req, res);
  } catch (e) {
    req.log.error(e, "Failed to logout of SSO");
  }
  deleteAuthCookies(req, res);

  return res.status(200).json({
    status: 200,
    redirectURI,
  });
}

export async function postLogin(
  // eslint-disable-next-line
  req: Request<any, any, { email: unknown; password: unknown }>,
  res: Response,
) {
  const { email, password } = req.body;

  if (typeof email !== "string" || typeof password !== "string") {
    throw new Error("Invalid email or password");
  }

  validatePasswordFormat(password);

  const user = await getUserByEmail(email);
  if (!user) {
    req.log.info("Unknown email: " + email);
    return res.status(400).json({
      status: 400,
      message: "Invalid email or password",
    });
  }

  const valid = await verifyPassword(user, password);
  if (!valid) {
    req.log.info("Invalid password for: " + email);
    return res.status(400).json({
      status: 400,
      message: "Invalid email or password",
    });
  }

  sendLocalSuccessResponse(req, res, user);
}

export async function postRegister(
  // eslint-disable-next-line
  req: Request<any, any, { email: unknown; name: unknown; password: unknown }>,
  res: Response,
) {
  const { email, name, password } = req.body;

  if (
    typeof email !== "string" ||
    typeof name !== "string" ||
    typeof password !== "string"
  ) {
    throw new Error("Invalid arguments");
  }

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

    return sendLocalSuccessResponse(req, res, existingUser);
  }

  // Create new account
  const user = await createUser({ name, email, password });
  sendLocalSuccessResponse(req, res, user);
}

export async function postFirstTimeRegister(
  req: Request<
    // eslint-disable-next-line
    any,
    // eslint-disable-next-line
    any,
    {
      email: unknown;
      name: unknown;
      password: unknown;
      companyname: unknown;
    }
  >,
  res: Response,
) {
  // Only allow this API endpoint when it's a brand-new installation with no users yet
  const newInstallation = await isNewInstallation();
  if (!newInstallation) {
    throw new Error(
      "An organization is already configured. Please refresh the page and try again.",
    );
  }

  const { email, name, password, companyname } = req.body;

  if (
    typeof email !== "string" ||
    typeof name !== "string" ||
    typeof password !== "string" ||
    typeof companyname !== "string"
  ) {
    throw new Error("Invalid arguments");
  }

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

  // grant the first user on a new installation super admin access
  const user = await createUser({ name, email, password, superAdmin: true });

  const org = await createOrganization({
    email,
    userId: user.id,
    name: companyname,
  });

  const context = getContextForAgendaJobByOrgObject(org);

  const project = await context.models.projects.create({
    name: "My First Project",
  });

  sendLocalSuccessResponse(req, res, user, project.id);
}

export async function postForgotPassword(
  // eslint-disable-next-line
  req: Request<any, any, { email: unknown }>,
  res: Response,
) {
  const { email } = req.body;
  if (!email || typeof email !== "string") {
    throw new Error("Invalid email");
  }

  await createForgotPasswordToken(email);

  res.status(200).json({
    status: 200,
  });
}

export async function getResetPassword(
  req: Request<{ token: unknown }>,
  res: Response,
) {
  const { token } = req.params;
  if (!token || typeof token !== "string") {
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

  const sso = await _dangerousGetSSOConnectionByEmailDomain(domain as string);

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
  req: Request<{ token: unknown }, any, { password: unknown }>,
  res: Response,
) {
  const { token } = req.params;
  const { password } = req.body;

  if (!token || typeof token !== "string") {
    throw new Error("Invalid password reset token.");
  }
  if (!password || typeof password !== "string") {
    throw new Error("Invalid password");
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

  // Revoke all refresh tokens for the user
  // Revoke all active JWT sessions for the user
  await resetMinTokenDate(userId);
  await AuthRefreshModel.deleteMany({
    userId: userId,
  });

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
  res: Response,
) {
  const { currentPassword, newPassword } = req.body;
  const { userId } = getContextFromReq(req);

  const user = await getUserById(userId);
  if (!user) {
    throw new Error("Invalid user");
  }

  const valid = await verifyPassword(user, currentPassword);
  if (!valid) {
    throw new Error("Current password is incorrect");
  }

  await updatePassword(user.id, newPassword);

  // Revoke all refresh tokens for the user
  // Revoke all active JWT sessions for the user
  await resetMinTokenDate(userId);
  await AuthRefreshModel.deleteMany({
    userId: userId,
  });

  // Send back an updated token for the current user so they are not logged out
  sendLocalSuccessResponse(req as Request, res, user);
}
