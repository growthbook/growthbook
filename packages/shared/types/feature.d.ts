/* eslint-disable @typescript-eslint/no-explicit-any */

import type { FeatureDefinition, FeatureResult } from "@growthbook/growthbook";
import { z } from "zod";
import {
  FeatureEnvironment,
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

type MakeOptionalIfPresent<T, K extends PropertyKey> = T extends any
  ? Omit<T, Extract<K, keyof T>> & Partial<Pick<T, Extract<K, keyof T>>>
  : never;

export type FeatureRuleWithoutValues = MakeOptionalIfPresent<
  FeatureRule,
  "value" | "values" | "variations" | "controlValue" | "variationValue"
>;

// JSON features can have very large values
// Omit them on the front-end unless specifically needed
export type FeatureWithoutValues = Omit<
  FeatureInterface,
  "environmentSettings" | "defaultValue" | "holdout"
> & {
  environmentSettings: Record<
    string,
    Omit<FeatureEnvironment, "rules"> & {
      rules: FeatureRuleWithoutValues[];
    }
  >;
  holdout?: { id: string; value?: string };
  defaultValue?: string;
};

export type ComputedFeatureInterface = FeatureWithoutValues & {
  projectId: string;
  projectName: string;
  projectIsDeReferenced: boolean;
  savedGroups: string[];
  stale: boolean;
  staleReason: string;
  ownerName: string;
};
