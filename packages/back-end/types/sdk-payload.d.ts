import { FeatureDefinition } from "./api";
import { VisualChangesetURLPattern } from "./visual-changeset";

// If this changes, also increment the LATEST_SDK_PAYLOAD_SCHEMA_VERSION constant
export type SDKPayloadContents = {
  features: Record<string, FeatureDefinition>;
  experiments: SDKExperiment[];
};

interface SDKExperiment {
  // From experiment.trackingKey
  key: string;
  status: string;
  variations: VisualExperimentVariation[];
  // The hashVersion should be hard-coded to `2`
  hashVersion: number;
  // From experiment.hashAttribute
  hashAttribute: string;
  urlPatterns: VisualChangesetURLPattern[];
  // From phases.variationWeights
  weights?: number[];
  meta?: VariationMeta[];
  filters?: Filter[];
  // From phase.seed
  seed?: string;
  // From experiment.name
  name?: string;
  // The array index of the latest phase as a string
  phase?: string;
  // If the experiment is stopped and `releasedVariationId` is set,
  // then `force` should be the array index of the released variation
  force?: number;
  // From phase.condition
  condition?: Record<string, unknown>;
  // From phase.coverage
  coverage?: number;
}

interface VisualExperimentVariation {
  css: string;
  js: string;
  domMutations: DOMMutation[];
}

interface DOMMutation {
  selector: string;
  action: "append" | "set" | "remove";
  attribute: string;
  value?: string;
  parentSelector?: string;
  insertBeforeSelector?: string;
}

interface VariationMeta {
  // variation.key
  key?: string;
  // variation.name
  name?: string;
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
