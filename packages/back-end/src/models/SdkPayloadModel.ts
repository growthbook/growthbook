import mongoose from "mongoose";
import { FeatureDefinition } from "../../types/api";
import { SDKPayloadInterface } from "../../types/sdk-payload";

const sdkPayloadSchema = new mongoose.Schema({
  organization: String,
  project: String,
  environment: String,
  dateUpdated: Date,
  deployed: Boolean,
  schemaVersion: Number,
  payload: String,
});
sdkPayloadSchema.index(
  { organization: 1, project: 1, environment: 1 },
  { unique: true }
);
type SDKPayloadDocument = mongoose.Document & SDKPayloadInterface;

const SDKPayloadModel = mongoose.model<SDKPayloadDocument>(
  "SdkPayload",
  sdkPayloadSchema
);

function toInterface(doc: SDKPayloadDocument): SDKPayloadInterface {
  return doc.toJSON();
}

export async function getSDKPayload({
  organization,
  project,
  environment,
}: {
  organization: string;
  project: string;
  environment: string;
}) {
  const doc = await SDKPayloadModel.findOne({
    organization,
    project,
    environment,
  });
  return doc ? toInterface(doc) : null;
}

export async function deleteSDKPayload({
  organization,
  project,
  environment,
}: {
  organization: string;
  project: string;
  environment: string;
}) {
  await SDKPayloadModel.deleteOne({
    organization,
    project,
    environment,
  });
}

export async function updateSDKPayload({
  organization,
  project,
  environment,
  features,
}: {
  organization: string;
  project: string;
  environment: string;
  features: Record<string, FeatureDefinition>;
}) {
  const now = new Date();
  await SDKPayloadModel.updateOne(
    {
      organization,
      project,
      environment,
    },
    {
      $set: {
        dateUpdated: now,
        deployed: false,
        schemaVersion: 1,
        payload: JSON.stringify({
          features,
          dateUpdated: now,
        }),
      },
    },
    {
      upsert: true,
    }
  );
}
