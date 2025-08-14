import { NextFunction, Response } from "express";
import { createAppAuth, createOAuthUserAuth } from "@octokit/auth-app";
import { getContextFromReq } from "back-end/src/services/organizations";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import {
  getGithubIntegrationByOrg,
  createGithubIntegration,
  toggleWatchingForRepo,
} from "back-end/src/models/GithubIntegration";
import { createGithubUserToken } from "back-end/src/models/GithubUserTokenModel";

const hasGithubEnvVars = () => {
  return (
    process.env.GITHUB_APP_ID &&
    process.env.GITHUB_PRIVATE_KEY &&
    process.env.GITHUB_CLIENT_ID &&
    process.env.GITHUB_CLIENT_SECRET
  );
};
const githubAuth = hasGithubEnvVars()
  ? createAppAuth({
      appId: process.env.GITHUB_APP_ID || "",
      privateKey: process.env.GITHUB_PRIVATE_KEY || "",
      clientId: process.env.GITHUB_CLIENT_ID || "",
      clientSecret: process.env.GITHUB_CLIENT_SECRET || "",
    })
  : null;

export const getGithubIntegration = async (req: AuthRequest, res: Response) => {
  const context = getContextFromReq(req);

  if (!context.permissions.canManageIntegrations()) {
    context.permissions.throwPermissionError();
  }

  return res.status(200).json({
    status: 200,
    githubIntegration: await getGithubIntegrationByOrg(context.org.id),
  });
};

export const postGithubIntegration = async (
  req: AuthRequest<{ code: string }>,
  res: Response,
  next: NextFunction,
) => {
  const context = getContextFromReq(req);

  if (!context.permissions.canManageIntegrations()) {
    context.permissions.throwPermissionError();
  }

  if (!githubAuth) return next();

  const code = req.body.code;

  if (!code || typeof code !== "string") return next();

  const userAuth = await githubAuth({
    type: "oauth-user",
    code,
    factory: createOAuthUserAuth,
  });

  // @ts-expect-error octokit types are out of date
  const authentication: {
    type: "token";
    tokenType: "oauth";
    clientType: "github-app";
    clientId: string;
    clientSecret: string;
    token: string;
    refreshToken: string;
    expiresAt: string;
    refreshTokenExpiresAt: string;
  } = await userAuth();

  const { org, userId } = getContextFromReq(req);

  const createdToken = await createGithubUserToken({
    token: authentication.token,
    organization: org.id,
    refreshToken: authentication.refreshToken,
    expiresAt: new Date(authentication.expiresAt),
    refreshTokenExpiresAt: new Date(authentication.refreshTokenExpiresAt),
  });

  const created = await createGithubIntegration({
    organization: org.id,
    tokenId: createdToken.id,
    createdBy: userId,
  });

  return res.status(201).json({
    status: 201,
    githubIntegration: created,
  });
};

export const postRepoWatch = async (
  req: AuthRequest<{ repoId: string }>,
  res: Response,
) => {
  const context = getContextFromReq(req);

  if (!context.permissions.canManageIntegrations()) {
    context.permissions.throwPermissionError();
  }

  const watching = await toggleWatchingForRepo({
    orgId: context.org.id,
    repoId: req.body.repoId,
  });

  return res.status(200).json({
    status: 200,
    watching,
  });
};
