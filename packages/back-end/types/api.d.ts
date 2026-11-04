import type { AuditInterfaceInput } from "shared/types/audit";
import type { EventUser } from "shared/types/events/event-types";
import type { ExperimentStatus } from "shared/types/experiment";
import type { OrganizationInterface } from "shared/types/organization";
import type { FeatureDefinition } from "shared/types/sdk";
import type { UserInterface } from "shared/types/user";
import type { ApiErrorCode, ApiErrorDetails } from "shared/validators";
import type { PermissionFunctions } from "back-end/src/types/AuthRequest";
import type { PublishGate } from "back-end/src/revisions/publishGates";
import type { ReqContext } from "./request";

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
  // Populated on 422 soft-warning responses; re-submit with `"ignoreWarnings": true` in the body to proceed.
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
