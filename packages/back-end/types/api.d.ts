import { ExperimentStatus } from "./experiment";

export interface ExperimentOverride {
  weights?: number[];
  status?: ExperimentStatus;
  force?: number;
  coverage?: number;
  groups?: string[];
  url?: string;
}

export interface FeatureDefinitionRule {
  type?: "force" | "experiment";
  value?: number;
  weights?: number[];
  variations?: number[];
  hashAttribute?: string;
  trackingKey?: string;
  coverage?: number;
  // eslint-disable-next-line
  condition?: any;
}

export interface FeatureDefinition {
  // eslint-disable-next-line
  values: any[];
  defaultValue: number;
  rules?: FeatureDefinitionRule[];
}

export interface ExperimentOverridesResponse {
  status: 200;
  features: Record<string, FeatureDefinition>;
  overrides: Record<string, ExperimentOverride>;
}

export interface ErrorResponse {
  status: 400;
  error: string;
}
