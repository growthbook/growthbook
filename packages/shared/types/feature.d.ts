/* eslint-disable @typescript-eslint/no-explicit-any */

import type { FeatureDefinition, FeatureResult } from "@growthbook/growthbook";
import { z } from "zod";
import {
  simpleSchemaFieldValidator,
  simpleSchemaValidator,
  FeatureInterface,
  V1FeatureRule,
  V1FeatureEnvironment,
  FeatureRevisionInterface,
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
  ContextualBanditRefRule,
  ContextualBanditRefVariation,
  RolloutRule,
  ExperimentRefVariation,
  ComputedFeatureInterface,
  V1FeatureRule,
  V1FeatureEnvironment,
  v1FeatureRule,
  v1FeatureEnvironment,
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

// ---------------------------------------------------------------------------
// Feature document schema generations
// ---------------------------------------------------------------------------
// A feature document on disk can be in one of three shapes: v0, v1, or v2.
// The JIT migration layer in `FeatureModel.toInterface` normalizes all three
// to the canonical v2 `FeatureInterface` on read; writes always emit v2.
//
// v0 — No `environmentSettings`. Top-level `rules: FeatureRule[]` +
//      `environments: string[]`. Upgraded by `upgradeV0Feature`.
// v1 — `environmentSettings[env].rules` with per-env rule arrays. Rules have
//      no `allEnvironments` / `environments` fields. May also carry stale
//      top-level `rules` left behind by an unscrubbed v0->v1 migration;
//      that crust is ignored. Flattened into v2 by `flattenV1ToV2Rules`.
// v2 — Top-level `rules: FeatureRule[]` where every rule has `allEnvironments`
//      (boolean) and an optional `environments` list. Each env in
//      `environmentSettings` is `{ enabled, prerequisites }` with NO `rules`
//      key — the absence of that key is the structural signal a document is
//      already v2 (see `hasNoV1EnvRules`). New writes go through
//      `buildFeatureUpdate`, which replaces each env wholesale to scrub the
//      legacy `rules` key off disk.
// ---------------------------------------------------------------------------

// v1 feature document on disk. Discriminate v1 vs v2 with
// `hasNoV1EnvRules` on the envSettings map.
export type V1FeatureInterface = Omit<
  FeatureInterface,
  "rules" | "environmentSettings"
> & {
  environmentSettings?: Record<string, V1FeatureEnvironment>;
  // Stale v0 crust left behind by an unscrubbed v0->v1 migration; ignored.
  rules?: V1FeatureRule[];
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

// v1 feature revision shape. Rules are the v1 `Record<env, V1FeatureRule[]>`
// instead of the v2 `FeatureRule[]` array. Used by `FeatureRevisionModel`
// JIT migration and `toLegacyRevision`.
export type V1FeatureRevisionInterface = Omit<
  FeatureRevisionInterface,
  "rules"
> & {
  rules: Record<string, V1FeatureRule[]>;
};

// Any non-v2 on-disk shape. v1 is a proper subset; v0 additionally carries a
// top-level `environments: string[]`. A v1 doc with leftover v0 crust is
// treated as v1 and the stale top-level `rules` is ignored. Accepted as input
// by the JIT upgrader in `FeatureModel.toInterface`.
export type LegacyFeatureInterface = V1FeatureInterface & {
  environments?: string[];
};

export interface FeatureDraftChanges {
  active: boolean;
  dateCreated?: Date;
  dateUpdated?: Date;
  defaultValue?: string;
  // v0-only per-env draft rules. Populated during v0->v1 upgrade and then
  // rolled into `legacyDraft` by `upgradeV0Feature`. `V1FeatureRule[]` is the
  // right element type — these entries pre-date the v2 rule shape.
  rules?: Record<string, V1FeatureRule[]>;
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
  hasPrerequisites?: boolean;
  hasSavedGroups?: boolean;
  ruleTypes?: Array<
    "force" | "rollout" | "safe-rollout" | "experiment" | "experiment-ref"
  >;
  revision?: {
    version: number;
    comment: string;
    date: Date;
    publishedBy: UserRef;
  };
};
