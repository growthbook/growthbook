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
  // eslint-disable-next-line
  force?: any;
  weights?: number[];
  // eslint-disable-next-line
  variations?: any[];
  hashAttribute?: string;
  key?: string;
  coverage?: number;
  // eslint-disable-next-line
  condition?: any;
}

export interface FeatureDefinition {
  // eslint-disable-next-line
  defaultValue: any;
  rules?: FeatureDefinitionRule[];
}

export interface ExperimentOverridesResponse {
  status: 200;
  overrides: Record<string, ExperimentOverride>;
}

export interface ErrorResponse {
  status: 400;
  error: string;
}
