import mongoose from "mongoose";
import { ObjectId } from "mongodb";
import { FeatureInterface, FeatureRule } from "../../types/feature";
import { FeatureRevisionInterface } from "../../types/feature-revision";
import { logger } from "../util/logger";

const featureRevisionSchema = new mongoose.Schema({
  organization: String,
  featureId: String,
  version: Number,
  dateCreated: Date,
  revisionDate: Date,
  publishedBy: {},
  comment: String,
  defaultValue: String,
  rules: {},
});

featureRevisionSchema.index(
  { organization: 1, featureId: 1, version: 1 },
  { unique: true }
);

type FeatureRevisionDocument = mongoose.Document<
  ObjectId | undefined,
  Record<string, never>,
  FeatureRevisionInterface
> &
  FeatureRevisionInterface;

const FeatureRevisionModel = mongoose.model<FeatureRevisionDocument>(
  "FeatureRevision",
  featureRevisionSchema
);

export async function getRevisions(
  organization: string,
  featureId: string
): Promise<FeatureRevisionInterface[]> {
  const docs = await FeatureRevisionModel.find({
    organization,
    featureId,
  });
  return docs.map((d) => d.toJSON({ flattenMaps: false }));
}

export async function saveRevision(feature: FeatureInterface) {
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
      publishedBy: feature.revision?.publishedBy || {
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
