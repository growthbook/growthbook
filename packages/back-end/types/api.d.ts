import { EventAuditUser } from "../src/events/base-types";
import { AuditInterface } from "./audit";
import { ExperimentStatus } from "./experiment";
import { OrganizationInterface } from "./organization";

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
  namespace?: [string, number, number];
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
  experiments: Record<string, { trackingKey: string }>;
}

export interface ErrorResponse {
  status: 400;
  error: string;
}

export interface ApiRequestLocals {
  apiKey: string;
  organization: OrganizationInterface;
  eventAudit: EventAuditUser;
  audit: (data: Partial<AuditInterface>) => Promise<void>;
}

export interface ApiErrorResponse {
  message: string;
}
