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
  /**
   * Evaluations in the selected window. A true COUNT(*), not a sum over the
   * returned rows — those are capped at the top 200 groups by volume, so
   * summing them understates a busy flag without saying so.
   */
  total: number;
  bySource: FeatureUsageDataPoint[];
  byValue: FeatureUsageDataPoint[];
  byRuleId: FeatureUsageDataPoint[];
  /**
   * Required rather than optional on purpose: every producer of this shape —
   * including the front-end dummy generator — should fail to compile until it
   * supplies one, rather than silently rendering an empty dimension.
   */
  byEnvironment: FeatureUsageDataPoint[];
}

/** The dimensions the chart can stack by. */
export type FeatureUsageDimension =
  | "value"
  | "source"
  | "ruleId"
  | "environment";

/**
 * One bucket of one group within a single dimension.
 *
 * Marginal, not joint: the chart stacks by one dimension at a time, so it needs
 * each dimension's distribution over time, never their cross product. The cross
 * product costs (buckets x product of cardinalities) rows to answer a question
 * nothing asks, and its only extra capability — client-side filtering across
 * dimensions — is one we deliberately do not want, because filters belong in
 * the WHERE clause behind Apply.
 */
export interface FeatureUsageMarginal {
  /** ISO 8601. */
  timestamp: string;
  group: string;
  evaluations: number;
}

export type FeatureUsageRowsByDimension = Record<
  FeatureUsageDimension,
  FeatureUsageMarginal[]
>;

/**
 * What a dimension's rows left out, reported per dimension because the
 * dimensions are nothing alike: `environment` is two or three groups, `ruleId`
 * can be hundreds. A single shared cap would truncate the long one while
 * leaving the short ones untouched, and say nothing about which.
 *
 * `includedEvaluations` against FeatureUsageData.total is the exact shortfall.
 * Groups past `cap` are folded into an "(other)" row rather than dropped, so
 * this normally matches — a gap means the warehouse-side safety limit engaged,
 * which is the only case where evaluations genuinely went missing.
 */
export interface FeatureUsageDimensionMeta {
  cap: number;
  returned: number;
  includedEvaluations: number;
}

export type FeatureUsageRowsMeta = Record<
  FeatureUsageDimension,
  FeatureUsageDimensionMeta
>;

/**
 * Window-independent facts about a feature's evaluations, which is why they are
 * not on FeatureUsageData: they cannot change when the selected window does, so
 * they must not be refetched when it does.
 *
 * Both are bounded by a lookback (see LAST_RECEIVED_LOOKBACK_DAYS), so neither
 * can establish "never" — only "not in the last N days". `lookbackDays` travels
 * with them so the UI states the bound instead of implying certainty it does
 * not have.
 */
export interface FeatureUsageSummary {
  lastEvaluated: string | null;
  lifetimeTotal: number;
  lookbackDays: number;
}

export type AttributeMap = Map<string, string>;

export type FeatureMetaInfo = Pick<
  FeatureInterface,
  | "id"
  | "project"
  | "targetingProjects"
  | "targetingAllProjects"
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
  // The flag's `baseConfig` (the config backing it), or null. Sent so the
  // feature list can show "Config · <name>" without shipping every default value.
  configBackingKey?: string | null;
  hasPrerequisites?: boolean;
  hasSavedGroups?: boolean;
  revision?: {
    version: number;
    comment: string;
    date: Date;
    publishedBy: UserRef;
  };
};
