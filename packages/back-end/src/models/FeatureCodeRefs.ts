import mongoose from "mongoose";
import { omit } from "lodash";
import { FeatureCodeRefsInterface } from "../../types/code-refs";
import { OrganizationInterface } from "../../types/organization";

const featureCodeRefsSchema = new mongoose.Schema({
  organization: String,
  dateUpdated: Date,
  feature: String,
  repo: String,
  branch: String,
  platform: {
    type: String,
    enum: ["github", "gitlab", "bitbucket"],
  },
  refs: [
    {
      filePath: String,
      startingLineNumber: Number,
      lines: String,
      flagKey: String,
    },
  ],
});

featureCodeRefsSchema.index(
  { organization: 1, repo: 1, branch: 1, feature: 1 },
  { unique: true }
);

type FeatureCodeRefsDocument = mongoose.Document & FeatureCodeRefsInterface;

const FeatureCodeRefsModel = mongoose.model<FeatureCodeRefsInterface>(
  "FeatureCodeRefs",
  featureCodeRefsSchema
);

function toInterface(doc: FeatureCodeRefsDocument): FeatureCodeRefsInterface {
  const ret = doc.toJSON<FeatureCodeRefsDocument>();
  return omit(ret, ["__v", "_id"]);
}

export const upsertFeatureCodeRefs = async ({
  feature,
  repo,
  branch,
  platform,
  codeRefs,
  organization,
}: {
  feature: string;
  repo: string;
  branch: string;
  platform?: "github" | "gitlab" | "bitbucket";
  codeRefs: FeatureCodeRefsInterface["refs"];
  organization: OrganizationInterface;
}): Promise<FeatureCodeRefsInterface[]> => {
  if (!feature || !repo || !branch || !codeRefs) {
    // eslint-disable-next-line no-console
    console.error("Missing required params", {
      feature,
      repo,
      branch,
      platform,
      codeRefs,
    });
    throw new Error("Missing required parameters");
  }

  await FeatureCodeRefsModel.updateMany(
    {
      feature,
      repo,
      branch,
      organization: organization.id,
    },
    {
      refs: codeRefs,
      platform,
      dateUpdated: new Date(),
    },
    { upsert: true }
  );

  return await FeatureCodeRefsModel.find({
    feature,
    repo,
    branch,
  }).then((docs) => docs.map(toInterface));
};

export const getFeatureCodeRefsByFeatures = async ({
  repo,
  branch,
  platform,
  features,
  organization,
}: {
  repo: string;
  branch: string;
  platform?: "github" | "gitlab" | "bitbucket";
  features: string[];
  organization: OrganizationInterface;
}): Promise<FeatureCodeRefsInterface[]> => {
  if (!repo || !branch) {
    // eslint-disable-next-line no-console
    console.error("Missing required parameters", {
      repo,
      branch,
      platform,
    });
    throw new Error("Missing required parameters");
  }

  return await FeatureCodeRefsModel.find({
    repo,
    branch,
    feature: { $in: features },
    organization: organization.id,
  }).then((docs) => docs.map(toInterface));
};

export const getAllCodeRefsForFeature = async ({
  feature,
  organization,
}: {
  feature: string;
  organization: OrganizationInterface;
}): Promise<FeatureCodeRefsInterface[]> => {
  if (!feature) throw new Error("Missing required parameters");
  return await FeatureCodeRefsModel.find({
    feature,
    organization: organization.id,
  }).then((docs) => docs.map(toInterface));
};
