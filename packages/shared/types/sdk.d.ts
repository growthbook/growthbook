import {
  AutoExperiment,
  ConditionInterface,
  FeatureRule,
  Filter,
  ParentConditionInterface,
} from "@growthbook/growthbook";

export type FeatureMetadata = {
  projects?: string[];
  // Set instead of `projects` when it's delivered to every project
  allProjects?: boolean;
  customFields?: Record<string, unknown>;
  tags?: string[];
};

// On a rule or auto experiment that serves a QA override in place of a draft
// experiment. Enough to tell the copies apart, to drop them from a payload,
// and to see what the experiment itself is configured to serve.
export type QaOverrideMetadata = {
  // The override this copy serves.
  id: string;
  type: "forced" | "random";
  // The experiment's own tracking key. The copy tracks under a QA key.
  key: string;
  status: "draft" | "running" | "stopped";
  // The experiment's own configuration, which the override may have replaced.
  weights?: number[];
  coverage?: number;
  condition?: ConditionInterface;
  parentConditions?: ParentConditionInterface[];
  namespace?: [string, number, number];
  filters?: Filter[];
  disableStickyBucketing?: boolean;
  // Auto experiments only. Shared by every copy of the same change.
  changeId?: string;
};

export type ExperimentMetadata = {
  projects?: string[];
  allProjects?: boolean;
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
  qaOverride?: QaOverrideMetadata;
};

// FeatureRule extended with optional metadata for experiment-ref rules
export type FeatureDefinitionRule = FeatureRule & {
  metadata?: ExperimentMetadata;
  contextualBanditRef?: string;
  contextualVariations?: unknown[];
};

export type ContextualBanditDefinition = {
  banditVersion?: number;
  contexts: {
    leafId: number;
    condition: Record<string, unknown>;
    weights: number[];
  }[];
};

export type ContextualBanditDefinitions = Record<
  string,
  ContextualBanditDefinition
>;

export type InterleavingDefinition = {
  trackingKey: string;
  // Carried here, not read off the pseudo flag's rule: remote evaluation
  // replaces rules with a forced defaultValue, so the rule is gone client-side.
  hashAttribute: string;
  seed: string;
  variations: { key: string; config: Record<string, unknown> }[];
};

export type InterleavingDefinitions = Record<string, InterleavingDefinition>;

export type AutoExperimentWithMetadata = AutoExperiment & {
  metadata?: ExperimentMetadata;
};

export interface FeatureDefinition {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  defaultValue: any;
  rules?: FeatureDefinitionRule[];
  metadata?: FeatureMetadata;
}
