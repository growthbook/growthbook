/**
 * @deprecated Legacy SDK payload cache model (org + environment level)
 * This model stores pre-processed feature definitions at the organization + environment level.
 * It still requires post-processing (scrubbing) for each SDK connection.
 *
 * Use the new SdkConnectionCacheModel instead, which stores fully-processed,
 * connection-specific payloads that are ready to serve directly.
 *
 * Collection: SdkPayloadCache
 * Key: { organization, environment, schemaVersion }
 */
import mongoose from "mongoose";
import {
  AutoExperimentWithProject,
  FeatureDefinitionWithProject,
  FeatureDefinitionWithProjects,
} from "shared/types/sdk";
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
  { unique: true },
);
type SDKPayloadDocument = mongoose.Document & SDKStringifiedPayloadInterface;

const SDKPayloadModel = mongoose.model<SDKStringifiedPayloadInterface>(
  "SdkPayloadCache",
  sdkPayloadSchema,
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

// TODO: add support for S3 and GCS
/**
 * @deprecated Legacy cache location check
 * This function checks if the legacy (org + environment) cache should be used.
 * The new sdkConnectionCache (per-connection) also respects this setting.
 */
export function getSDKPayloadCacheLocation(): "mongo" | "none" {
  const loc = process.env.SDK_PAYLOAD_CACHE;
  if (loc === "none") return "none";
  // Default to mongo
  return "mongo";
}

/**
 * @deprecated Legacy SDK payload cache reader (org + environment level)
 * Retrieves pre-processed feature definitions that still require scrubbing per connection.
 * Use sdkConnectionCache.getById() instead for fully-processed payloads.
 */
export async function getSDKPayload({
  organization,
  environment,
}: {
  organization: string;
  environment: string;
}): Promise<SDKPayloadInterface | null> {
  const storageLocation = getSDKPayloadCacheLocation();
  if (storageLocation === "none") {
    return null;
  }

  const doc = await SDKPayloadModel.findOne({
    organization,
    environment,
    schemaVersion: LATEST_SDK_PAYLOAD_SCHEMA_VERSION,
  });

  return doc ? toInterface(doc) : null;
}

/**
 * @deprecated Legacy SDK payload cache writer (org + environment level)
 * Stores pre-processed feature definitions that still require scrubbing per connection.
 * Use sdkConnectionCache.upsert() instead for fully-processed payloads.
 */
export async function updateSDKPayload({
  organization,
  environment,
  featureDefinitions,
  experimentsDefinitions,
  savedGroupsInUse,
  holdoutFeatureDefinitions,
}: {
  organization: string;
  environment: string;
  featureDefinitions: Record<string, FeatureDefinitionWithProject>;
  experimentsDefinitions: AutoExperimentWithProject[];
  savedGroupsInUse: string[];
  holdoutFeatureDefinitions: Record<string, FeatureDefinitionWithProjects>;
}) {
  const storageLocation = getSDKPayloadCacheLocation();
  if (storageLocation === "none") {
    return;
  }

  const contents: SDKPayloadContents = {
    features: featureDefinitions,
    experiments: experimentsDefinitions,
    savedGroupsInUse: savedGroupsInUse,
    holdouts: holdoutFeatureDefinitions,
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
    },
  );
}
