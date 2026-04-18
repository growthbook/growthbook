/* eslint-disable @typescript-eslint/no-explicit-any */

import type { FeatureDefinition, FeatureResult } from "@growthbook/growthbook";
import { z } from "zod";
import {
  simpleSchemaFieldValidator,
  simpleSchemaValidator,
  FeatureRule,
  FeatureInterface,
} from "shared/validators";
import { UserRef } from "./user";

export {
  FeatureRule,
  FeatureInterface,
  FeatureEnvironment,
  FeatureValueType,
  ForceRule,
  ExperimentValue,
  ExperimentRule,
  ScheduleRule,
  ExperimentRefRule,
  RolloutRule,
  ExperimentRefVariation,
  ComputedFeatureInterface,
} from "shared/validators";

export {
  NamespaceValue,
  SavedGroupTargeting,
  FeaturePrerequisite,
} from "shared/validators";

export type SchemaField = z.infer<typeof simpleSchemaFieldValidator>;
export type SimpleSchema = z.infer<typeof simpleSchemaValidator>;

export interface JSONSchemaDef {
  schemaType: "schema" | "simple";
  schema: string;
  simple: SimpleSchema;
  date: Date;
  enabled: boolean;
}

// Legacy per-env environment settings. In the pre-unification shape, rules
// lived inside `environmentSettings[env].rules`. The new shape drops this
// field — rules now live at the feature's top-level `rules` array.
export type LegacyFeatureEnvironment = {
  enabled: boolean;
  prerequisites?: FeaturePrerequisite[];
  rules?: FeatureRule[];
};

// Represents a feature document as it may appear on disk across several
// generations of the schema. The JIT upgrader in FeatureModel.toInterface
// normalizes all of these shapes to the unified FeatureInterface:
//   (1) Very old: top-level `rules` + `environments` arrays, no environmentSettings.
//   (2) Pre-unification: `environmentSettings[env].rules` per environment.
//   (3) Unified (post-cutover): top-level `rules: FeatureRule[]` with uids; no
//       per-env rules. This is what the upgrader emits.
// Discrimination between (2) and (3) is structural: isUnifiedFeatureEnvSettings
// returns false iff ANY env object still carries a `rules` key (meaning the
// doc is still in legacy shape and must be flattened). Unified writes go
// through buildFeatureUpdate which strips `rules` from every env object.
export type LegacyFeatureInterface = Omit<
  FeatureInterface,
  "rules" | "environmentSettings"
> & {
  environmentSettings?: Record<string, LegacyFeatureEnvironment>;
  // (1) very-old top-level envs list
  environments?: string[];
  // Either (1) pre-env-rules top-level rules OR (3) unified flat rules with uids.
  // The upgrader decides which based on the envSettings discriminator above
  // plus presence of legacy-only fields on the document.
  rules?: FeatureRule[];
  revision?: {
    version: number;
    comment: string;
    date: Date;
    publishedBy: UserRef;
  };
  draft?: FeatureDraftChanges;
  // schemaType and simple may not exist in old feature documents
  jsonSchema?: Omit<JSONSchemaDef, "schemaType" | "simple"> &
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

export interface FeatureTestResult {
  env: string;
  enabled: boolean;
  result: null | FeatureResult;
  defaultValue: boolean | string | object;
  log?: [string, any][];
  featureDefinition?: FeatureDefinition;
}
export type FeatureUsageDataPoint = {
  t: number;
  v: Record<string, number>;
};

export interface FeatureUsageData {
  total: number;
  bySource: FeatureUsageDataPoint[];
  byValue: FeatureUsageDataPoint[];
  byRuleId: FeatureUsageDataPoint[];
}

export type AttributeMap = Map<string, string>;

export type FeatureMetaInfo = Pick<
  FeatureInterface,
  | "id"
  | "project"
  | "archived"
  | "description"
  | "dateCreated"
  | "dateUpdated"
  | "tags"
  | "owner"
  | "valueType"
  | "version"
  | "linkedExperiments"
  | "neverStale"
> & {
  defaultValue?: string;
  revision?: {
    version: number;
    comment: string;
    date: Date;
    publishedBy: UserRef;
  };
};
