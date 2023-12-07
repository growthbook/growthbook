import { omit } from "lodash";
import uniqid from "uniqid";
import mongoose from "mongoose";
import {
  GithubIntegrationInterface,
  CreateGithubIntegrationInput,
} from "../../types/github";
import { OrganizationInterface } from "../../types/organization";
import { doesTokenExist } from "./GithubUserTokenModel";

type GithubIntegrationDocument = mongoose.Document & GithubIntegrationInterface;

const githubIntegrationSchema = new mongoose.Schema({
  id: String,
  organization: String,
  tokenId: String,
  createdBy: String,
  createdAt: Date,
});

githubIntegrationSchema.index({ organization: 1 }, { unique: true });
githubIntegrationSchema.index({ tokenId: 1 }, { unique: true });

const GithubIntegrationModel = mongoose.model<GithubIntegrationDocument>(
  "GithubIntegration",
  githubIntegrationSchema
);

const toInterface = (
  doc: GithubIntegrationDocument
): GithubIntegrationInterface =>
  omit(doc.toJSON<GithubIntegrationDocument>(), ["__v", "_id"]);

export const getGithubIntegrationByOrg = async (
  orgId: OrganizationInterface["id"]
) => {
  const doc = await GithubIntegrationModel.findOne({ organization: orgId });
  return doc ? toInterface(doc) : null;
};

export const createGithubIntegration = async (
  input: CreateGithubIntegrationInput
) => {
  if (!(await doesTokenExist(input.tokenId)))
    throw new Error("Token does not exist");

  const doc = await GithubIntegrationModel.create({
    ...input,
    id: uniqid("ghi_"),
    createdAt: new Date(),
  });

  return toInterface(doc);
};
