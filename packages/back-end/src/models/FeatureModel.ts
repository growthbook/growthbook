import { FilterQuery } from "mongodb";
import mongoose from "mongoose";
import { FeatureInterface } from "../../types/feature";

const featureSchema = new mongoose.Schema({
  id: String,
  description: String,
  organization: String,
  project: String,
  dateCreated: Date,
  dateUpdated: Date,
  valueType: String,
  defaultValue: String,
  rules: [
    {
      _id: false,
      id: String,
      type: {
        type: String,
      },
      trackingKey: String,
      value: String,
      coverage: Number,
      hashAttribute: String,
      enabled: Boolean,
      condition: String,
      description: String,
      values: [
        {
          _id: false,
          value: String,
          weight: Number,
        },
      ],
    },
  ],
});

featureSchema.index({ id: 1, organization: 1 }, { unique: true });

type FeatureDocument = mongoose.Document & FeatureInterface;

const FeatureModel = mongoose.model<FeatureDocument>("Feature", featureSchema);

export async function getAllFeatures(
  organization: string,
  project?: string
): Promise<FeatureInterface[]> {
  const q: FilterQuery<FeatureDocument> = { organization };
  if (project) {
    q[project] = project;
  }

  return (await FeatureModel.find(q)).map((m) => m.toJSON());
}

export async function getFeature(
  organization: string,
  id: string
): Promise<FeatureInterface | null> {
  const feature = await FeatureModel.findOne({ organization, id });
  return feature ? feature.toJSON() : null;
}

export async function createFeature(data: FeatureInterface) {
  await FeatureModel.create(data);
}

export async function deleteFeature(organization: string, id: string) {
  await FeatureModel.deleteOne({ organization, id });
}

export async function updateFeature(
  organization: string,
  id: string,
  updates: Partial<FeatureInterface>
) {
  await FeatureModel.updateOne(
    { organization, id },
    {
      $set: updates,
    }
  );
}
