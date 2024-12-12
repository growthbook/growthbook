/* eslint-disable @typescript-eslint/no-explicit-any */

import type { FeatureDefinition, FeatureResult } from "@growthbook/growthbook";
import { z } from "zod";
import {
  simpleSchemaFieldValidator,
  simpleSchemaValidator,
  FeatureRule,
  FeatureInterface,
} from "back-end/src/validators/features";
import { UserRef } from "./user";

export {
  FeatureRule,
  FeatureInterface,
  FeaturePrerequisite,
  FeatureEnvironment,
  FeatureValueType,
  ForceRule,
  ExperimentValue,
  ExperimentRule,
  ScheduleRule,
  ExperimentRefRule,
  RolloutRule,
  NamespaceValue,
  SavedGroupTargeting,
  ExperimentRefVariation,
  ComputedFeatureInterface,
} from "back-end/src/validators/features";

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
