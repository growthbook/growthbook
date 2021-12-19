import { ExperimentStatus } from "./experiment";

export interface ExperimentOverride {
  experimentId?: string;
  weights?: number[];
  status?: ExperimentStatus;
  force?: number;
  coverage?: number;
  groups?: string[];
  url?: string;
}

export interface ExperimentOverridesResponse {
  status: 200;
  overrides: Record<string, ExperimentOverride>;
  experiments: Record<string, { trackingKey: string }>;
}

export interface ErrorResponse {
  status: 400;
  error: string;
}
