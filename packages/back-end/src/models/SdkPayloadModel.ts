import mongoose from "mongoose";
import { FeatureDefinition } from "../../types/api";
import {
  SDKPayloadContents,
  SDKPayloadInterface,
  SDKStringifiedPayloadInterface,
} from "../../types/sdk-payload";

// Increment this if we change the shape of the payload contents
export const LATEST_SDK_PAYLOAD_SCHEMA_VERSION = 1;

const sdkPayloadSchema = new mongoose.Schema({
  organization: String,
  project: String,
  environment: String,
  dateUpdated: Date,
  deployed: Boolean,
  schemaVersion: Number,
  contents: String,
});
sdkPayloadSchema.index(
  { organization: 1, project: 1, environment: 1 },
  { unique: true }
);
type SDKPayloadDocument = mongoose.Document & SDKStringifiedPayloadInterface;

const SDKPayloadModel = mongoose.model<SDKPayloadDocument>(
  "SdkPayload",
  sdkPayloadSchema
);

function toInterface(doc: SDKPayloadDocument): SDKPayloadInterface | null {
  const json = doc.toJSON();
  try {
    const contents = JSON.parse(json.contents);

    // TODO: better validation here to make sure contents are the correct type?
    if (!contents.features) return null;

    return {
      ...json,
      contents,
    };
  } catch (e) {
    return null;
  }
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
    schemaVersion: LATEST_SDK_PAYLOAD_SCHEMA_VERSION,
  });
  return doc ? toInterface(doc) : null;
}

export async function updateSDKPayload({
  organization,
  project,
  environment,
  featureDefinitions,
}: {
  organization: string;
  project: string;
  environment: string;
  featureDefinitions: Record<string, FeatureDefinition>;
}) {
  const contents: SDKPayloadContents = {
    features: featureDefinitions,
  };

  await SDKPayloadModel.updateOne(
    {
      organization,
      project,
      environment,
    },
    {
      $set: {
        dateUpdated: new Date(),
        deployed: false,
        schemaVersion: LATEST_SDK_PAYLOAD_SCHEMA_VERSION,
        // Contents need to be serialized since they may contain invalid Mongo field keys
        contents: JSON.stringify(contents),
      },
    },
    {
      upsert: true,
    }
  );
}
