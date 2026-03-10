import { omit } from "lodash";
import uniqid from "uniqid";
import mongoose from "mongoose";
import { refreshToken } from "@octokit/oauth-methods";
import {
  GithubUserTokenInterface,
  CreateGithubUserTokenInput,
} from "shared/types/github";

type GithubUserTokenDocument = mongoose.Document & GithubUserTokenInterface;

const githubUserTokenSchema = new mongoose.Schema({
  id: String,
  organization: String,
  token: String,
  expiresAt: Date,
  refreshToken: String,
  refreshTokenExpiresAt: Date,
  createdAt: Date,
  updatedAt: Date,
});

const GithubUserTokenModel = mongoose.model<GithubUserTokenDocument>(
  "GithubUserToken",
  githubUserTokenSchema,
);

const toInterface = (doc: GithubUserTokenDocument): GithubUserTokenInterface =>
  omit(doc.toJSON<GithubUserTokenDocument>(), ["__v", "_id"]);

export const createGithubUserToken = async (
  token: CreateGithubUserTokenInput,
) => {
  const doc = await GithubUserTokenModel.create({
    ...token,
    id: uniqid("ghut_"),
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return toInterface(doc);
};

export const doesTokenExist = async (tokenId: string) => {
  return await GithubUserTokenModel.exists({
    id: tokenId,
  });
};

const refreshGithubUserToken = async (token: GithubUserTokenDocument) => {
  const { authentication } = await refreshToken({
    clientType: "github-app",
    clientId: process.env.GITHUB_CLIENT_ID || "",
    clientSecret: process.env.GITHUB_CLIENT_SECRET || "",
    refreshToken: token.refreshToken,
  });
  if (!authentication)
    throw new Error("Github integration - Token refresh failed");
  await GithubUserTokenModel.updateOne<GithubUserTokenDocument>(
    { id: token.id },
    {
      token: authentication.token,
      expiresAt: authentication.expiresAt,
      refreshToken: authentication.refreshToken,
      refreshTokenExpiresAt: authentication.refreshTokenExpiresAt,
      updatedAt: new Date(),
    },
  );
  const updated = await GithubUserTokenModel.findOne({ id: token.id });
  if (!updated) throw new Error("Github integration - Token refresh failed");
  return updated;
};

export const getGithubUserToken = async (tokenId: string) => {
  let token = await GithubUserTokenModel.findOne({ id: tokenId });
  if (!token) throw new Error("Token not found");
  if (token.expiresAt < new Date()) token = await refreshGithubUserToken(token);
  return token.token;
};
