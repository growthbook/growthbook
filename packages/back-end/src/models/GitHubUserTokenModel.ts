import { omit } from "lodash";
import uniqid from "uniqid";
import mongoose from "mongoose";
import {
  GitHubUserTokenInterface,
  CreateGithubUserTokenInput,
} from "../../types/github";
import { OrganizationInterface } from "../../types/organization";

type GitHubUserTokenDocument = mongoose.Document & GitHubUserTokenInterface;

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

// TODO figure out how to do unique if not null in mongoose
// githubUserTokenSchema.index(
//   { organization: 1 },
//   {
//     unique: true,
//   }
// );

const GitHubUserTokenModel = mongoose.model<GitHubUserTokenDocument>(
  "GitHubUserToken",
  githubUserTokenSchema
);

const toInterface = (doc: GitHubUserTokenDocument): GitHubUserTokenInterface =>
  omit(doc.toJSON<GitHubUserTokenDocument>(), ["__v", "_id"]);

export const getGitHubUserTokenByOrg = async (org: OrganizationInterface) => {
  const doc = await GitHubUserTokenModel.findOne({ organization: org.id });
  return doc ? toInterface(doc) : null;
};

export const createGitHubUserToken = async (
  token: CreateGithubUserTokenInput
) => {
  const doc = await GitHubUserTokenModel.create({
    ...token,
    id: uniqid("github_"),
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return toInterface(doc);
};

export const removeGitHubUserToken = async (org: OrganizationInterface) => {
  await GitHubUserTokenModel.deleteOne({ organization: org.id });
};
