import mongoose from "mongoose";
import { FeatureInterface, FeatureRule } from "../../types/feature";
import { FeatureRevisionInterface } from "../../types/feature-revision";

const featureRevisionSchema = new mongoose.Schema({
  organization: String,
  featureId: String,
  revision: Number,
  dateCreated: Date,
  revisionDate: Date,
  userId: String,
  userEmail: String,
  userName: String,
  comment: String,
  defaultValue: String,
  rules: {},
});

featureRevisionSchema.index({ organization: 1, featureId: 1 });

type FeatureRevisionDocument = mongoose.Document & FeatureRevisionInterface;

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
  return docs.map((d) => d.toJSON());
}

export async function saveRevision(feature: FeatureInterface) {
  const rules: Record<string, FeatureRule[]> = {};
  Object.keys(feature.environmentSettings || {}).forEach((env) => {
    rules[env] = feature.environmentSettings?.[env]?.rules || [];
  });

  await FeatureRevisionModel.create({
    organization: feature.organization,
    featureId: feature.id,
    revision: feature.revision?.version || 1,
    dateCreated: new Date(),
    revisionDate: feature.revision?.date || feature.dateCreated,
    userId: feature.revision?.userId || "",
    userEmail: feature.revision?.userEmail || "",
    userName: feature.revision?.userName || "",
    comment: feature.revision?.comment || "",
    defaultValue: feature.defaultValue,
    rules,
  });
}
