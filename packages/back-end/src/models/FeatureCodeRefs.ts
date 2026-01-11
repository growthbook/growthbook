import mongoose from "mongoose";
import { FeatureCodeRefsInterface } from "shared/types/code-refs";
import { ApiCodeRef } from "shared/types/openapi";
import { OrganizationInterface } from "shared/types/organization";
import {
  ToInterface,
  getCollection,
  removeMongooseFields,
} from "back-end/src/util/mongo.util";
import { ReqContext } from "back-end/types/request";
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
  { unique: true },
);
// Helper for getting a unique string for sorting since the model has no id field
export function uniqueId(codeRef: FeatureCodeRefsInterface) {
  return `${codeRef.organization}/${codeRef.repo}/${codeRef.branch}/${codeRef.feature}`;
}

type FeatureCodeRefsDocument = mongoose.Document & FeatureCodeRefsInterface;

const FeatureCodeRefsModel = mongoose.model<FeatureCodeRefsInterface>(
  "FeatureCodeRefs",
  featureCodeRefsSchema,
);

const COLLECTION = "featurecoderefs";

const toInterface: ToInterface<FeatureCodeRefsInterface> = (doc) =>
  removeMongooseFields(doc);

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
    { upsert: true },
  );

  const docs = await getCollection(COLLECTION)
    .find({
      feature,
      repo,
      branch,
      organization: organization.id,
    })
    .toArray();

  return docs.map((d) => toInterface(d));
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
  const docs = await getCollection(COLLECTION)
    .find({
      repo,
      branch,
      feature: { $in: features },
      organization: organization.id,
    })
    .toArray();

  return docs.map((d) => toInterface(d));
};

export const getAllCodeRefsForFeature = async ({
  feature,
  organization,
}: {
  feature: string;
  organization: OrganizationInterface;
}): Promise<FeatureCodeRefsInterface[]> => {
  const docs = await getCollection(COLLECTION)
    .find({
      feature,
      organization: organization.id,
    })
    .toArray();

  return docs.map((d) => toInterface(d));
};

export const getAllCodeRefsForOrg = async ({
  context,
}: {
  context: ReqContext | ApiReqContext;
}): Promise<FeatureCodeRefsInterface[]> => {
  const docs = await getCollection(COLLECTION)
    .find({
      organization: context.org.id,
    })
    .toArray();

  return docs.map((d) => toInterface(d));
};

export const getCodeRefsForRepoBranch = async ({
  repo,
  branch,
  organization,
}: {
  repo: string;
  branch: string;
  organization: OrganizationInterface;
}): Promise<FeatureCodeRefsInterface[]> => {
  const docs = await getCollection(COLLECTION)
    .find({
      organization: organization.id,
      repo,
      branch,
    })
    .toArray();

  return docs.map((d) => toInterface(d));
};

export const getExistingFeaturesForRepoBranch = async ({
  repo,
  branch,
  organization,
}: {
  repo: string;
  branch: string;
  organization: OrganizationInterface;
}): Promise<string[]> => {
  const docs = await getCollection(COLLECTION)
    .find(
      {
        organization: organization.id,
        repo,
        branch,
      },
      { projection: { feature: 1, _id: 0 } },
    )
    .toArray();

  return docs.map((d) => d.feature as string);
};

export const bulkUpsertFeatureCodeRefs = async ({
  repo,
  branch,
  platform,
  updates,
  organization,
}: {
  repo: string;
  branch: string;
  platform?: "github" | "gitlab" | "bitbucket";
  updates: Array<{
    feature: string;
    codeRefs: FeatureCodeRefsInterface["refs"];
  }>;
  organization: OrganizationInterface;
}): Promise<void> => {
  if (updates.length === 0) return;

  const bulkOps = updates.map((update) => ({
    updateOne: {
      filter: {
        organization: organization.id,
        repo,
        branch,
        feature: update.feature,
      },
      update: {
        $set: {
          refs: update.codeRefs,
          platform,
          dateUpdated: new Date(),
        },
      },
      upsert: true,
    },
  }));

  await getCollection(COLLECTION).bulkWrite(bulkOps, { ordered: false });
};

export const getFeatureKeysForRepoBranch = async ({
  repo,
  branch,
  features,
  organization,
}: {
  repo: string;
  branch: string;
  features: string[];
  organization: OrganizationInterface;
}): Promise<string[]> => {
  const docs = await getCollection(COLLECTION)
    .find(
      {
        repo,
        branch,
        feature: { $in: features },
        organization: organization.id,
      },
      { projection: { feature: 1, _id: 0 } },
    )
    .toArray();

  return docs.map((d) => d.feature as string);
};
