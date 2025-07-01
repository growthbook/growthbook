import mongoose from "mongoose";
import { omit } from "lodash";
import { FeatureCodeRefsInterface } from "back-end/types/code-refs";
import { ApiCodeRef } from "back-end/types/openapi";
import { OrganizationInterface, ReqContext } from "back-end/types/organization";
import { ApiReqContext } from "back-end/types/api";

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
// Helper for getting a unique string for sorting since the model has no id field
export function uniqueId(codeRef: FeatureCodeRefsInterface) {
  return `${codeRef.organization}/${codeRef.repo}/${codeRef.branch}/${codeRef.feature}`;
}

type FeatureCodeRefsDocument = mongoose.Document & FeatureCodeRefsInterface;

const FeatureCodeRefsModel = mongoose.model<FeatureCodeRefsInterface>(
  "FeatureCodeRefs",
  featureCodeRefsSchema
);

function toInterface(doc: FeatureCodeRefsDocument): FeatureCodeRefsInterface {
  const ret = doc.toJSON<FeatureCodeRefsDocument>();
  return omit(ret, ["__v", "_id"]);
}

export function toApiInterface(doc: FeatureCodeRefsDocument): ApiCodeRef {
  return {
    branch: doc.branch,
    dateUpdated: doc.dateUpdated?.toISOString(),
    feature: doc.feature,
    organization: doc.organization,
    platform: doc.platform,
    refs: doc.refs.map((ref) => ({
      filePath: ref.filePath,
      startingLineNumber: ref.startingLineNumber,
      lines: ref.lines,
      flagKey: ref.flagKey,
    })),
    repo: doc.repo,
  };
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
    organization: organization.id,
  }).then((docs) => docs.map(toInterface));
};

export const getFeatureCodeRefsByFeatures = async ({
  repo,
  branch,
  features,
  organization,
}: {
  repo: string;
  branch: string;
  features: string[];
  organization: OrganizationInterface;
}): Promise<FeatureCodeRefsInterface[]> => {
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
  return await FeatureCodeRefsModel.find({
    feature,
    organization: organization.id,
  }).then((docs) => docs.map(toInterface));
};

export const getAllCodeRefsForOrg = async ({
  context,
}: {
  context: ReqContext | ApiReqContext;
}): Promise<FeatureCodeRefsInterface[]> => {
  return await FeatureCodeRefsModel.find({
    organization: context.org.id,
  }).then((docs) => docs.map(toInterface));
};

export const upsertFeatureCodeRefsWithRemoval = async ({
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
  // Get existing code references for this feature
  const existingCodeRefs = await FeatureCodeRefsModel.find({
    feature,
    repo,
    branch,
    organization: organization.id,
  });

  // If no existing references and no new references, nothing to do
  if (existingCodeRefs.length === 0 && codeRefs.length === 0) {
    return [];
  }

  // If no new references, remove all existing references
  if (codeRefs.length === 0) {
    await FeatureCodeRefsModel.deleteMany({
      feature,
      repo,
      branch,
      organization: organization.id,
    });
    return [];
  }

  // Update with new references (this will replace all existing ones)
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
    organization: organization.id,
  }).then((docs) => docs.map(toInterface));
};
