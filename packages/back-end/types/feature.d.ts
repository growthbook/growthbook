/* eslint-disable @typescript-eslint/no-explicit-any */

import type { FeatureDefinition, FeatureResult } from "@growthbook/growthbook";
import { z } from "zod";
import {
  simpleSchemaFieldValidator,
  simpleSchemaValidator,
} from "@back-end/src/validators/features";
import { UserRef } from "./user";
import { FeatureRevisionInterface } from "./feature-revision";

export type FeatureValueType = "boolean" | "string" | "number" | "json";

export interface FeatureEnvironment {
  enabled: boolean;
  rules: FeatureRule[];
}

export type SchemaField = z.infer<typeof simpleSchemaFieldValidator>;
export type SimpleSchema = z.infer<typeof simpleSchemaValidator>;

export interface JSONSchemaDef {
  schemaType: "schema" | "simple";
  schema: string;
  simple: SimpleSchema;
  date: Date;
  enabled: boolean;
}

export type LegacyFeatureInterface = FeatureInterface & {
  environments?: string[];
  rules?: FeatureRule[];
  revision?: {
    version: number;
    comment: string;
    date: Date;
    publishedBy: UserRef;
  };
  draft?: FeatureDraftChanges;
  // schemaType and simple may not exist in old feature documents
  jsonSchema?: Pick<JSONSchemaDef, "schema" | "date" | "enabled"> &
    Partial<Pick<JSONSchemaDef, "schemaType" | "simple">>;
};

export interface FeatureDraftChanges {
  active: boolean;
  dateCreated?: Date;
  dateUpdated?: Date;
  defaultValue?: string;
  rules?: Record<string, FeatureRule[]>;
  comment?: string;
}

export interface FeatureInterface {
  id: string;
  archived?: boolean;
  description?: string;
  organization: string;
  nextScheduledUpdate?: Date | null;
  owner: string;
  project?: string;
  dateCreated: Date;
  dateUpdated: Date;
  valueType: FeatureValueType;
  defaultValue: string;
  version: number;
  hasDrafts?: boolean;
  tags?: string[];
  environmentSettings: Record<string, FeatureEnvironment>;
  linkedExperiments?: string[];
  jsonSchema?: JSONSchemaDef;

  /** @deprecated */
  legacyDraft?: FeatureRevisionInterface | null;
  /** @deprecated */
  legacyDraftMigrated?: boolean;
  neverStale?: boolean;
  prerequisites?: FeaturePrerequisite[];
}
type ScheduleRule = {
  timestamp: string | null;
  enabled: boolean;
};

export interface SavedGroupTargeting {
  match: "all" | "none" | "any";
  ids: string[];
}

export interface BaseRule {
  description: string;
  condition?: string;
  id: string;
  enabled?: boolean;
  scheduleRules?: ScheduleRule[];
  savedGroups?: SavedGroupTargeting[];
  prerequisites?: FeaturePrerequisite[];
}

export interface ForceRule extends BaseRule {
  type: "force";
  value: string;
}

export interface RolloutRule extends BaseRule {
  type: "rollout";
  value: string;
  coverage: number;
  hashAttribute: string;
}

type ExperimentValue = {
  value: string;
  weight: number;
  name?: string;
};

export type NamespaceValue = {
  enabled: boolean;
  name: string;
  range: [number, number];
};

/**
 * @deprecated
 */
export interface ExperimentRule extends BaseRule {
  type: "experiment";
  trackingKey: string;
  hashAttribute: string;
  fallbackAttribute?: string;
  hashVersion?: number;
  disableStickyBucketing?: boolean;
  bucketVersion?: number;
  minBucketVersion?: number;
  namespace?: NamespaceValue;
  coverage?: number;
  values: ExperimentValue[];
}

export interface ExperimentRefVariation {
  variationId: string;
  value: string;
}

export interface ExperimentRefRule extends BaseRule {
  type: "experiment-ref";
  experimentId: string;
  variations: ExperimentRefVariation[];
}

export type FeatureRule =
  | ForceRule
  | RolloutRule
  | ExperimentRule
  | ExperimentRefRule;

export interface FeatureTestResult {
  env: string;
  enabled: boolean;
  result: null | FeatureResult;
  defaultValue: boolean | string | object;
  log?: [string, any][];
  featureDefinition?: FeatureDefinition;
}

export interface FeaturePrerequisite {
  id: string;
  condition: string;
}
