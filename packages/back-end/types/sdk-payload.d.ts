import { FeatureDefinition } from "./api";

// If this changes, also increment the LATEST_SDK_PAYLOAD_SCHEMA_VERSION constant
export type SDKPayloadContents = {
  features: Record<string, FeatureDefinition>;
};

export interface SDKPayloadInterface {
  organization: string;
  project: string;
  environment: string;
  dateUpdated: Date;
  deployed: boolean;
  schemaVersion: number;
  contents: SDKPayloadContents;
}

export type SDKStringifiedPayloadInterface = Omit<
  SDKPayloadInterface,
  "contents"
> & {
  contents: string;
};

export type SDKPayloadKey = {
  environment: string;
  project: string;
};
