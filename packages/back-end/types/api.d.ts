import {
  AutoExperiment,
  FeatureRule as FeatureDefinitionRule,
} from "@growthbook/growthbook";
import { EventAuditUser } from "../src/events/event-types";
import { PermissionFunctions } from "../src/types/AuthRequest";
import { AuditInterface } from "./audit";
import { ExperimentStatus } from "./experiment";
import { OrganizationInterface, ReqContext } from "./organization";
import { UserInterface } from "./user";

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

export type FeatureDefinitionWithProject = FeatureDefinition & {
  project?: string;
};

export type AutoExperimentWithProject = AutoExperiment & {
  project?: string;
};

export interface ExperimentOverridesResponse {
  status: 200;
  overrides: Record<string, ExperimentOverride>;
  experiments: Record<string, { trackingKey: string }>;
}

export interface ErrorResponse {
  status: 400;
  error: string;
}

// req.user is not always guaranteed within API requests
export type ApiReqContext = Omit<
  ReqContext,
  "userName" | "userId" | "email"
> & {
  userId?: string;
  email?: string;
  userName?: string;
};

export type ApiRequestLocals = PermissionFunctions & {
  apiKey: string;
  user?: UserInterface;
  organization: OrganizationInterface;
  eventAudit: EventAuditUser;
  audit: (data: Partial<AuditInterface>) => Promise<void>;
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
