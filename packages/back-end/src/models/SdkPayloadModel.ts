import mongoose from "mongoose";
import { FeatureDefinition } from "../../types/api";
import {
  SDKExperiment,
  SDKPayloadContents,
  SDKPayloadInterface,
  SDKStringifiedPayloadInterface,
} from "../../types/sdk-payload";

// Increment this if we change the payload contents in a backwards-incompatible way
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
  try {
    const contents = JSON.parse(doc.contents);

    // TODO: better validation here to make sure contents are the correct type?
    if (!contents.features && !contents.experiments) return null;

    return {
      ...doc,
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
}): Promise<SDKPayloadInterface | null> {
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
  experimentsDefinitions,
}: {
  organization: string;
  project: string;
  environment: string;
  featureDefinitions: Record<string, FeatureDefinition>;
  experimentsDefinitions: SDKExperiment[];
}) {
  const contents: SDKPayloadContents = {
    features: featureDefinitions,
    experiments: experimentsDefinitions,
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
