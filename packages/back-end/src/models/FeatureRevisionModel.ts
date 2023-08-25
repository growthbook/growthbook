import mongoose from "mongoose";
import { FeatureInterface, FeatureRule } from "../../types/feature";
import { FeatureRevisionInterface } from "../../types/feature-revision";
import { logger } from "../util/logger";

const featureRevisionSchema = new mongoose.Schema({
  organization: String,
  featureId: String,
  version: Number,
  dateCreated: Date,
  dateUpdated: {
    type: Date,
    required: false,
  },
  revisionDate: Date,
  publishedBy: {},
  comment: String,
  defaultValue: String,
  rules: {},
  creatorUserId: {
    type: String,
    required: false,
  },
  status: {
    type: String,
    required: false,
    enum: ["published", "draft"], // todo: everything with these
  },
  baseVersion: {
    type: String,
    required: false,
  },
});

featureRevisionSchema.index(
  { organization: 1, featureId: 1, version: 1 },
  { unique: true }
);

type FeatureRevisionDocument = mongoose.Document & FeatureRevisionInterface;

const FeatureRevisionModel = mongoose.model<FeatureRevisionInterface>(
  "FeatureRevision",
  featureRevisionSchema
);

export async function getRevisions(
  organization: string,
  featureId: string
): Promise<FeatureRevisionInterface[]> {
  const docs: FeatureRevisionDocument[] = await FeatureRevisionModel.find({
    organization,
    featureId,
  });
  return docs.map((d) => d.toJSON<FeatureRevisionDocument>());
}

type SaveRevisionParams = {
  state: "published" | "draft";
  feature: FeatureInterface;
};

// todo: support creating draft revisions
export async function saveRevision({ feature, state }: SaveRevisionParams) {
  const rules: Record<string, FeatureRule[]> = {};
  Object.keys(feature.environmentSettings || {}).forEach((env) => {
    rules[env] = feature.environmentSettings?.[env]?.rules || [];
  });

  try {
    await FeatureRevisionModel.create({
      organization: feature.organization,
      featureId: feature.id,
      version: feature.revision?.version || 1,
      dateCreated: new Date(),
      revisionDate: feature.revision?.date || feature.dateCreated,
      state,
      publishedBy:
        state === "draft"
          ? null
          : feature.revision?.publishedBy || {
              id: "",
              email: "",
              name: "",
            },
      comment: feature.revision?.comment || "",
      defaultValue: feature.defaultValue,
      rules,
    });
  } catch (e) {
    // The most likely error is a duplicate key error from the revision version
    // This is not a fatal error and should not stop the feature from being created
    logger.error(e, "Error saving feature revision");

    // TODO: handle duplicate key errors more elegantly
  }
}
