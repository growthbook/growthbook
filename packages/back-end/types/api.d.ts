import { FeatureRule as FeatureDefinitionRule } from "@growthbook/growthbook";
import { EventAuditUser } from "../src/events/event-types";
import { PermissionFunctions } from "../src/types/AuthRequest";
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

export type ApiRequestLocals = PermissionFunctions & {
  apiKey: string;
  organization: OrganizationInterface;
  eventAudit: EventAuditUser;
  audit: (data: Partial<AuditInterface>) => Promise<void>;
};

export interface ApiErrorResponse {
  message: string;
}

/**
 * In the private API, there is a convention to add `status: number` to all response types.
 */
export interface PrivateApiErrorResponse {
  status: number;
  message: string;
}
