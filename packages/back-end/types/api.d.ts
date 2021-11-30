import { ExperimentStatus } from "./experiment";

export interface ExperimentOverride {
  weights?: number[];
  status?: ExperimentStatus;
  force?: number;
  coverage?: number;
  groups?: string[];
  url?: string;
}

export interface FeatureDefinition {
  // eslint-disable-next-line
  values: any[];
  defaultValue: number;
  rules?: {
    type: "rollout" | "force" | "experiment";
    weights?: number[];
    // eslint-disable-next-line
    condition?: any;
    value?: number;
    experiment?: string;
    variations?: number[];
  }[];
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
