import mongoose from "mongoose";
import {
  AutoExperimentWithProject,
  FeatureDefinitionWithProject,
} from "back-end/types/api";
import {
  SDKPayloadContents,
  SDKPayloadInterface,
  SDKStringifiedPayloadInterface,
} from "back-end/types/sdk-payload";

// Increment this if we change the payload contents in a backwards-incompatible way
export const LATEST_SDK_PAYLOAD_SCHEMA_VERSION = 1;

const sdkPayloadSchema = new mongoose.Schema({
  organization: String,
  environment: String,
  dateUpdated: Date,
  deployed: Boolean,
  schemaVersion: Number,
  contents: String,
});
sdkPayloadSchema.index(
  { organization: 1, environment: 1, schemaVersion: 1 },
  { unique: true }
);
type SDKPayloadDocument = mongoose.Document & SDKStringifiedPayloadInterface;

const SDKPayloadModel = mongoose.model<SDKStringifiedPayloadInterface>(
  "SdkPayloadCache",
  sdkPayloadSchema
);

function toInterface(doc: SDKPayloadDocument): SDKPayloadInterface | null {
  const json = doc.toJSON<SDKPayloadDocument>();
  try {
    const contents = JSON.parse(json.contents);

    // TODO: better validation here to make sure contents are the correct type?
    if (!contents.features && !contents.experiments) return null;

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
  environment,
}: {
  organization: string;
  environment: string;
}): Promise<SDKPayloadInterface | null> {
  const doc = await SDKPayloadModel.findOne({
    organization,
    environment,
    schemaVersion: LATEST_SDK_PAYLOAD_SCHEMA_VERSION,
  });

  return doc ? toInterface(doc) : null;
}

export async function updateSDKPayload({
  organization,
  environment,
  featureDefinitions,
  experimentsDefinitions,
  savedGroupsInUse,
}: {
  organization: string;
  environment: string;
  featureDefinitions: Record<string, FeatureDefinitionWithProject>;
  experimentsDefinitions: AutoExperimentWithProject[];
  savedGroupsInUse: string[];
}) {
  const contents: SDKPayloadContents = {
    features: featureDefinitions,
    experiments: experimentsDefinitions,
    savedGroupsInUse: savedGroupsInUse,
  };

  await SDKPayloadModel.updateOne(
    {
      organization,
      environment,
      schemaVersion: LATEST_SDK_PAYLOAD_SCHEMA_VERSION,
    },
    {
      $set: {
        dateUpdated: new Date(),
        deployed: false,
        // Contents need to be serialized since they may contain invalid Mongo field keys
        contents: JSON.stringify(contents),
      },
    },
    {
      upsert: true,
    }
  );
}
