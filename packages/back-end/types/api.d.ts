import {
  AutoExperiment,
  FeatureDefinition as SDKFeatureDefinition,
  FeatureMetadata,
} from "@growthbook/growthbook";
import { EventUser } from "back-end/src/events/event-types";
import { PermissionFunctions } from "back-end/src/types/AuthRequest";
import { AuditInterfaceInput } from "./audit";
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

export type { FeatureMetadata };

// make defaultValue required for API contract
export type FeatureDefinition = Omit<SDKFeatureDefinition, "defaultValue"> & {
  // eslint-disable-next-line
  defaultValue: any;
};

export type FeatureDefinitionWithProject = FeatureDefinition & {
  project?: string;
};

export type FeatureDefinitionWithProjects = FeatureDefinition & {
  projects?: string[];
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
