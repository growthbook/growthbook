export interface ExperimentOverride {
  weights?: number[];
  status?: "draft" | "running" | "stopped";
  force?: number;
  coverage?: number;
  groups?: string[];
  url?: string;
}

export interface ExperimentOverridesResponse {
  status: 200;
  overrides: Record<string, ExperimentOverride>;
}

export interface ErrorResponse {
  status: 400;
  error: string;
}
