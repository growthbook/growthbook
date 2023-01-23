import { AuditInterface } from "./audit";
import { ExperimentStatus } from "./experiment";
import { FeatureRule, FeatureValueType } from "./feature";
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
  audit: (data: Partial<AuditInterface>) => Promise<void>;
}

export interface ApiErrorResponse {
  message: string;
}

export interface ApiPaginationFields {
  limit: number;
  offset: number;
  count: number;
  total: number;
  hasMore: boolean;
  nextOffset: number | null;
}

export interface ApiFeatureEnvironmentInterface {
  enabled: boolean;
  defaultValue: string;
  rules: FeatureRule[];
  definition: FeatureDefinition | null;
  draft: null | {
    enabled: boolean;
    defaultValue: string;
    rules: FeatureRule[];
    definition: FeatureDefinition | null;
  };
}

export interface ApiFeatureInterface {
  id: string;
  archived: boolean;
  description: string;
  owner: string;
  project: string;
  dateCreated: string;
  dateUpdated: string;
  valueType: FeatureValueType;
  defaultValue: string;
  tags: string[];
  environments: Record<string, ApiFeatureEnvironmentInterface>;
  revision: {
    version: number;
    comment: string;
    date: string;
    publishedBy: string;
  };
}

export type ApiSDKConnectionInterface = {
  id: string;
  name: string;
  dateCreated: string;
  dateUpdated: string;
  languages: string[];
  environment: string;
  project: string;
  encryptPayload: boolean;
  encryptionKey: string;
  key: string;
  proxyEnabled: boolean;
  proxyHost: string;
  proxySigningKey: string;
};
