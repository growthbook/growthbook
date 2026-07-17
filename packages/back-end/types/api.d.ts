import { AuditInterfaceInput } from "shared/types/audit";
import { EventUser } from "shared/types/events/event-types";
import { ExperimentStatus } from "shared/types/experiment";
import { OrganizationInterface } from "shared/types/organization";
import { FeatureDefinition } from "shared/types/sdk";
import { UserInterface } from "shared/types/user";
import { ApiErrorCode, ApiErrorDetails } from "shared/validators";
import { PermissionFunctions } from "back-end/src/types/AuthRequest";
import { PublishGate } from "back-end/src/revisions/publishGates";
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
  isJwtAuth?: boolean;
};

type ApiErrorResponseBase = {
  message: string;
  code?: undefined;
  details?: undefined;
  conflicts?: unknown[];
  // Populated on 422 soft-warning responses; re-submit with ?ignoreWarnings=true to proceed.
  warnings?: string[];
  // Populated on 422 blocked-publish responses: every blocking gate and the body flag that clears it.
  gates?: PublishGate[];
};
type ApiErrorResponseStructured = {
  [C in ApiErrorCode]: {
    message: string;
    code: C;
    details: ApiErrorDetails<C>;
    /** @deprecated Read `details.conflicts` instead. Populated only when code === "conflict" for backwards compatibility. */
    conflicts?: unknown[];
    warnings?: string[];
    gates?: PublishGate[];
  };
}[ApiErrorCode];

export type ApiErrorResponse =
  | ApiErrorResponseBase
  | ApiErrorResponseStructured;

/**
 * In the private API, there is a convention to add `status: number` to all response types.
 */
export interface PrivateApiErrorResponse {
  status: number;
  message: string;
}

export type ApiReqContext = ReqContext;
