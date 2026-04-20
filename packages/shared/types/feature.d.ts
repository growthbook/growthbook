/* eslint-disable @typescript-eslint/no-explicit-any */

import type { FeatureDefinition, FeatureResult } from "@growthbook/growthbook";
import { z } from "zod";
import {
  simpleSchemaFieldValidator,
  simpleSchemaValidator,
  FeatureRule,
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
// A feature document on disk can be in one of three shapes, which we label v0,
// v1, and v2. The JIT migration layer in FeatureModel.toInterface normalizes
// all three to the canonical v2 FeatureInterface on read. Writes always emit
// v2.
//
// v0 — Very old, pre-environmentSettings. No `environmentSettings` field at
//      all. Top-level `rules: FeatureRule[]` + `environments: string[]` arrays.
//      Rare on disk (~137 of 162,795 features at time of cutover). Upgraded by
//      `upgradeV0Feature` (was `upgradeFeatureInterface`) into a v1 shape.
//
// v1 — Pre-unification. Has `environmentSettings[env].rules` with per-env rule
//      arrays. May also carry leftover top-level `rules` from a partial v0->v1
//      migration that never scrubbed the old field; that top-level crust is
//      ignored in the v1 path. Rules have no `allEnvironments`, no
//      `environments` fields. Flattened into v2 by `flattenV1ToV2Rules`.
//
// v2 — Unified (canonical; post-cutover). `FeatureInterface` itself. Top-level
//      `rules: FeatureRule[]` where every rule has a boolean `allEnvironments`
//      and an optional `environments` list. Each env in `environmentSettings`
//      is `{ enabled, prerequisites }` — NO `rules` key.
//      The absence of a `rules` key on every env object is the structural
//      signal that a document is already v2 (see `isV2FeatureEnvSettings`).
//      New writes go through `buildFeatureUpdate` which replaces each env
//      wholesale to scrub the legacy `rules` key from disk.
// ---------------------------------------------------------------------------

// v1 per-env environment settings and v1 rule types are zod-backed in
// shared/validators/features.ts and re-exported here. They are permissive
// (`.passthrough()`) by design so (a) downconverted v2 rules can pass their
// (possibly-suffixed) `id` through unchanged, and (b) future v2-only fields
// added to `FeatureRule` do NOT implicitly widen `V1FeatureRule`. See the
// doc block next to the zod definitions for rationale.

// v1 feature document on disk. Has `environmentSettings[env].rules`. May or
// may not have stale top-level `rules` left over from a v0->v1 migration that
// didn't scrub the old field. Discriminate v1 vs v2 with
// `isV2FeatureEnvSettings` on the envSettings map.
export type V1FeatureInterface = Omit<
  FeatureInterface,
  "rules" | "environmentSettings"
> & {
  environmentSettings?: Record<string, V1FeatureEnvironment>;
  // Stale v0 crust — ignored in the v1 path. Present only when a v0->v1
  // migration left the top-level `rules` field behind.
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

// Vocabulary-only alias. Use `V2FeatureInterface` at conversion boundaries
// (e.g. `flattenV1ToV2Rules` output, legacy<->v2 REST adapters) to make it
// explicit that the value has been normalized to v2. `FeatureInterface` is
// the canonical v2 type; they are identical.
export type V2FeatureInterface = FeatureInterface;

// v1 feature revision shape. Rules are the v1 `Record<env, V1FeatureRule[]>`
// instead of the v2 `FeatureRule[]` array. Used by `FeatureRevisionModel`
// JIT migration and will be used by `toLegacyRevision` in Phase 2b.3.
export type V1FeatureRevisionInterface = Omit<
  FeatureRevisionInterface,
  "rules"
> & {
  rules: Record<string, V1FeatureRule[]>;
};

// Constructive union for "any non-v2 on-disk shape". Covers both v0 and v1
// documents. The JIT upgrader in FeatureModel.toInterface accepts this as
// input. Structurally:
//   - v0: no `environmentSettings`; has top-level `rules` and `environments`.
//   - v1: has `environmentSettings`, at least one env has a `rules` key.
//   - v1 with v0 crust: both shapes' fields present; we treat as v1 and
//     ignore the stale top-level `rules`.
// v1 is a proper subset of `LegacyFeatureInterface`; v0 adds only the
// top-level `environments: string[]` field.
export type LegacyFeatureInterface = V1FeatureInterface & {
  environments?: string[];
};

export interface FeatureDraftChanges {
  active: boolean;
  dateCreated?: Date;
  dateUpdated?: Date;
  defaultValue?: string;
  // v0-legacy per-env draft rules. Only populated on v0 docs during v0->v1
  // upgrade, then rolled into `legacyDraft` (a revision) by `upgradeV0Feature`.
  // Typed as `V1FeatureRule[]` because these pre-date v2 unification entirely.
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
  revision?: {
    version: number;
    comment: string;
    date: Date;
    publishedBy: UserRef;
  };
};
