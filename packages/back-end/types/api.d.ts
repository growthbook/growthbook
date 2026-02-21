import { AuditInterfaceInput } from "shared/types/audit";
import { EventUser } from "shared/types/events/event-types";
import { ExperimentStatus } from "shared/types/experiment";
import { OrganizationInterface } from "shared/types/organization";
import { FeatureDefinition } from "shared/types/sdk";
import { UserInterface } from "shared/types/user";
import { PermissionFunctions } from "back-end/src/types/AuthRequest";
import { ReqContext } from "./request";

export interface ExperimentOverride {
  weights?: number[];
  status?: ExperimentStatus;
  force?: number;
  coverage?: number;
  groups?: string[];
  url?: string;
}

export type { FeatureDefinition };

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
  user?: UserInterface;
  organization: OrganizationInterface;
  eventAudit: EventUser;
  audit: (data: AuditInterfaceInput) => Promise<void>;
  context: ApiReqContext;
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

export type ApiReqContext = ReqContext;
