import { ExperimentStatus } from "./experiment";
import { FeatureEnvironment, FeatureValueType } from "./feature";
import { OrganizationInterface } from "./organization";
import { UserRef } from "./user";

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
}

export interface ApiFeatureInterface {
  id: string;
  archived: boolean;
  description: string;
  owner: string;
  project: string;
  dateCreated: Date;
  dateUpdated: Date;
  valueType: FeatureValueType;
  defaultValue: string;
  tags: string[];
  environments: Record<string, FeatureEnvironment>;
  draftEnvironments: Record<string, FeatureEnvironment>;
  revision: {
    version: number;
    comment: string;
    date: Date;
    publishedBy: UserRef;
  };
}
