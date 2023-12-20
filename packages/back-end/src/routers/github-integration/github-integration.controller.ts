import { NextFunction, Request, Response } from "express";
import { Octokit } from "@octokit/rest";
import { createAppAuth, createOAuthUserAuth } from "@octokit/auth-app";
import { getOrgFromReq } from "../../services/organizations";
import { webhooks } from "../../services/github";
import { AuthRequest } from "../../types/AuthRequest";
import {
  getGithubIntegrationByOrg,
  createGithubIntegration,
  toggleWatchingForRepo,
} from "../../models/GithubIntegration";
import { createGithubUserToken } from "../../models/GithubUserTokenModel";

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
  req.checkPermissions("manageIntegrations");
  const { org } = getOrgFromReq(req);
  return res.status(200).json({
    status: 200,
    githubIntegration: await getGithubIntegrationByOrg(org.id),
  });
};

export const postGithubIntegration = async (
  req: AuthRequest<{ code: string }>,
  res: Response,
  next: NextFunction
) => {
  req.checkPermissions("manageIntegrations");

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

  const { org, userId } = getOrgFromReq(req);

  // get installation id
  const octokit = new Octokit({ auth: authentication.token });
  const { data: installationsRes } = await octokit.request(
    "GET /user/installations"
  );
  const installation = installationsRes.installations.find(
    (installation) => `${installation.app_id}` === process.env.GITHUB_APP_ID
  );

  if (!installation)
    return res.status(400).json({
      status: 400,
      message: "Could not find installation",
    });

  // get repositories
  const installationAuth = await githubAuth({
    type: "installation",
    installationId: installation.id,
  });
  const installationOctokit = new Octokit({ auth: installationAuth.token });
  const { data: reposRes } = await installationOctokit.request(
    "GET /installation/repositories"
  );

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
    installationId: `${installation.id}`,
    createdBy: userId,
    repositories: reposRes.repositories.map((repo) => ({
      id: repo.id.toString(),
      name: repo.name,
      watching: false,
    })),
  });

  return res.status(201).json({
    status: 201,
    githubIntegration: created,
  });
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

// individual webhook event handlers are defined in services/github.ts
export const webhookHandler = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  if (!webhooks) return next();

  const githubSignature = req.headers["x-hub-signature-256"];
  const signature = await webhooks.sign(JSON.stringify(req.body));

  if (githubSignature !== signature)
    return res.status(401).json({
      status: 401,
      message: "Invalid signature",
    });

  await webhooks.receive({
    id: req.headers["x-github-delivery"] as string,
    name: req.headers["x-github-event"] as string,
    payload: req.body,
  });

  res.status(200).json({
    status: 200,
  });
};
