import { AutoExperiment, FeatureRule } from "@growthbook/growthbook";

export type FeatureMetadata = {
  projects?: string[];
  customFields?: Record<string, unknown>;
  tags?: string[];
};

export type ExperimentMetadata = {
  projects?: string[];
  customFields?: Record<string, unknown>;
  tags?: string[];
  // ISO datetimes of the experiment's scheduled start/end, when the SDK
  // Connection opts into emitting them.
  startDate?: string;
  endDate?: string;
  // A relative end ("N days/hours after start") that hasn't been anchored to a
  // concrete date yet (a scheduled draft). Consumable without a discrete date;
  // once the experiment starts this resolves and is emitted as `endDate`.
  endAfterStart?: { value: number; unit: "hours" | "days" };
};

// FeatureRule extended with optional metadata for experiment-ref rules
export type FeatureDefinitionRule = FeatureRule & {
  metadata?: ExperimentMetadata;
  isContextualBandit?: boolean;
  attributesRequired?: string[];
  contexts?: {
    leafId: number;
    condition: Record<string, unknown>;
    weights: number[];
  }[];
};

export type AutoExperimentWithMetadata = AutoExperiment & {
  metadata?: ExperimentMetadata;
};

export interface FeatureDefinition {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  defaultValue: any;
  rules?: FeatureDefinitionRule[];
  metadata?: FeatureMetadata;
}
