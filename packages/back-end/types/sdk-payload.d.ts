import type { AutoExperiment } from "@growthbook/growthbook";
import { FeatureDefinition } from "./api";

// If this changes, also increment the LATEST_SDK_PAYLOAD_SCHEMA_VERSION constant
export type SDKPayloadContents = {
  features: Record<string, FeatureDefinition>;
  holdouts?: Record<string, FeatureDefinition>;
  experiments: AutoExperiment[];
  savedGroupsInUse?: string[]; // The ids of saved groups to be pulled from Mongo before returning the SDK payload
};

interface DOMMutation {
  selector: string;
  action: "append" | "set" | "remove";
  attribute: string;
  value?: string;
  parentSelector?: string;
  insertBeforeSelector?: string;
}

// Used for namespaces
// Include when phase.namespace.enabled is true
interface Filter {
  // experiment.hashAttribute
  attribute?: string;
  // phase.namespace.name
  seed: string;
  // Hard-code this to `2`
  hashVersion: number;
  // An array with a single element: phase.namespace.range
  ranges: VariationRange[];
}

type VariationRange = [number, number];

export interface SDKPayloadInterface {
  organization: string;
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
