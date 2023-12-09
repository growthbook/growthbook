import fs from "fs";
import { Request, NextFunction, Response } from "express";
import { createAppAuth, createOAuthUserAuth } from "@octokit/auth-app";
import { getOrgFromReq } from "../../services/organizations";
import { AuthRequest } from "../../types/AuthRequest";
import {
  getGithubIntegrationByOrg,
  createGithubIntegration,
  toggleWatchingForRepo,
} from "../../models/GithubIntegration";
import { createGithubUserToken } from "../../models/GithubUserTokenModel";
import { APP_ORIGIN } from "../../util/secrets";

const githubPrivateKey = fs.readFileSync(
  process.env.GITHUB_PRIVATE_KEY_PATH || "",
  "utf8"
);

const githubAuth = createAppAuth({
  appId: process.env.GITHUB_APP_ID || "",
  privateKey: githubPrivateKey,
  clientId: process.env.GITHUB_CLIENT_ID || "",
  clientSecret: process.env.GITHUB_CLIENT_SECRET || "",
});

export const getGithubIntegration = async (req: AuthRequest, res: Response) => {
  req.checkPermissions("manageIntegrations");
  const { org } = getOrgFromReq(req);
  return res.status(200).json({
    status: 200,
    githubIntegration: await getGithubIntegrationByOrg(org.id),
  });
};

export const postGithubIntegration = async (
  req: AuthRequest<{ tokenId: string }>,
  res: Response
) => {
  req.checkPermissions("manageIntegrations");

  const { org, userId } = getOrgFromReq(req);

  if (!req.body.tokenId)
    return res.status(400).json({
      status: 400,
      message: "tokenId is required",
    });

  const created = await createGithubIntegration({
    organization: org.id,
    tokenId: req.body.tokenId,
    createdBy: userId,
  });

  return res.status(201).json({
    status: 201,
    githubIntegration: created,
  });
};

export const completeOAuthFlow = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const code = req.query.code;

  if (!code || typeof code !== "string") {
    return next();
  }

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

  const createdToken = await createGithubUserToken({
    token: authentication.token,
    refreshToken: authentication.refreshToken,
    expiresAt: new Date(authentication.expiresAt),
    refreshTokenExpiresAt: new Date(authentication.refreshTokenExpiresAt),
  });

  res.redirect(APP_ORIGIN + "/integrations/github?t_id=" + createdToken.id);
};

export const postRepoWatch = async (
  req: AuthRequest<{ repoId: string }>,
  res: Response
) => {
  req.checkPermissions("manageIntegrations");

  const { org } = getOrgFromReq(req);

  const watching = await toggleWatchingForRepo({
    orgId: org.id,
    repoId: req.body.repoId,
  });

  return res.status(200).json({
    status: 200,
    watching,
  });
};
