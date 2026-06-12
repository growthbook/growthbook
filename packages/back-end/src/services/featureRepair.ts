import { cloneDeep, isEqual, omit } from "lodash";
import { getRulesForEnvironment } from "shared/util";
import { ACTIVE_DRAFT_STATUSES } from "shared/validators";
import {
  FeatureInterface,
  FeatureRule,
  LegacyFeatureInterface,
} from "shared/types/feature";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import {
  FeatureModel,
  migrateRawFeatureToV2,
  updateFeature,
} from "back-end/src/models/FeatureModel";
import { buildFeatureRevisionInterface } from "back-end/src/models/FeatureRevisionModel";
import {
  getApplicableEnvIds,
  isV2RevisionRules,
} from "back-end/src/util/flattenRules";
import { getCollection } from "back-end/src/util/mongo.util";
import { getEnvironments } from "back-end/src/util/organization.util";
import { auditDetailsUpdate } from "back-end/src/services/audit";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";
import { logger } from "back-end/src/util/logger";

const REVISIONS_COLLECTION = "featurerevisions";
const FEATURE_BATCH_SIZE = 50;

export type RepairDirection = "feature_from_revision" | "revision_from_feature";

/**
 * On-disk storage shape of a doc:
 * - v0: feature doc with no `environmentSettings` (pre-environments schema)
 * - v1: rules stored per-env (`environmentSettings.{env}.rules` on features,
 *   `Record<env, rules>` on revisions)
 * - v2: flat top-level `rules` array with env scoping fields
 * - mixed: v2 top-level rules but legacy v1 per-env rules still on disk
 */
export type FeatureDocShape = "v0" | "v1" | "v2" | "mixed";
export type RevisionDocShape = "v1" | "v2";

export interface FeatureRepairFinding {
  featureId: string;
  /** The feature's live revision number */
  version: number;
  project: string;
  archived: boolean;
  dateUpdated: Date | null;
  /** Storage shape of the raw feature doc */
  featureDocShape: FeatureDocShape;
  /** Storage shape of the live revision doc (null when missing) */
  liveRevisionDocShape: RevisionDocShape | null;
  /** Envs whose legacy `environmentSettings.{env}.rules` arrays are still on disk */
  legacyEnvRulesOnDisk: string[];
  /** Stored top-level `rules` is missing or not v2-shaped while the feature has rules */
  nonV2TopLevelRules: boolean;
  /** No revision doc exists at the feature's current version */
  missingLiveRevision: boolean;
  /** Live revision doc stores rules in a pre-v2 shape */
  legacyLiveRevisionDoc: boolean;
  /** Feature doc and live revision disagree (post-migration views) */
  drift: {
    defaultValue: boolean;
    envs: string[];
    direction: RepairDirection;
  } | null;
  /** Revisions marked published at a version above the feature's (never applied) */
  phantomPublishedVersions: number[];
  /** Active drafts whose rules empty out envs that currently serve rules */
  corruptDrafts: {
    version: number;
    wipedEnvs: string[];
    /** How each wiped env would be restored (filled in by the planning pass) */
    envPlans?: {
      env: string;
      source: "replay" | "live";
      orderUncertain: boolean;
      reason: string | null;
      ruleCount: number;
    }[];
  }[];
  /**
   * Drafts that empty serving envs but whose revision logs contain enough
   * "delete rule" events to account for every removed rule — likely an
   * intentional cleanup, so reported as a note instead of a corrupt draft.
   */
  emptiedDraftsWithHistory: { version: number; wipedEnvs: string[] }[];
  /** Analysis threw for this feature; flags above are unreliable (see server logs) */
  analysisError?: boolean;
}

/**
 * The two repair actions, deliberately narrow:
 * - "drift": run the production GET-path self-heal (rewrite the feature doc
 *   from its live revision). Features whose live revision looks sparse are
 *   skipped — repairing those would wipe serving rules.
 * - "corruptDrafts": reset the content of active drafts that would empty
 *   currently-serving envs back to the live state, with an explanatory
 *   comment. Author edits in those drafts are discarded (revision logs are
 *   not reliably replayable), so the author re-applies intended changes.
 */
export type FeatureRepairMode = "drift" | "corruptDrafts";

export interface FeatureRepairProposal {
  finding: FeatureRepairFinding;
  feature: {
    rules: { before: unknown; after: FeatureRule[] } | null;
    defaultValue: { before: string; after: string } | null;
  };
  notes: string[];
}

export interface FeatureRepairScanResult {
  featuresScanned: number;
  findings: FeatureRepairFinding[];
  summary: {
    featuresFlagged: number;
    legacyEnvRulesOnDisk: number;
    nonV2TopLevelRules: number;
    missingLiveRevision: number;
    legacyLiveRevisionDoc: number;
    drift: number;
    phantomPublishedRevisions: number;
    corruptDrafts: number;
    emptiedDraftsWithHistory: number;
  };
}

export interface FeatureRepairApplyResult {
  featureId: string;
  status: "repaired" | "skipped" | "error";
  actions: string[];
  error?: string;
}

type RawFeatureDoc = LegacyFeatureInterface & Record<string, unknown>;
type RawRevisionDoc = FeatureRevisionInterface & Record<string, unknown>;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

// Envs whose legacy per-env rules arrays are still stored on the raw doc.
// `rules: []` counts as scrubbed (mirrors `hasNoV1EnvRules`).
function legacyEnvRulesEnvs(raw: RawFeatureDoc): string[] {
  const envSettings = (raw.environmentSettings ?? {}) as Record<
    string,
    { rules?: unknown } | undefined
  >;
  return Object.entries(envSettings)
    .filter(
      ([, setting]) =>
        setting &&
        typeof setting === "object" &&
        Array.isArray(setting.rules) &&
        setting.rules.length > 0,
    )
    .map(([env]) => env);
}

// Mirrors `migrateRawFeatureToV2`'s v2 detection: rules written by the v2
// pipeline always carry env scoping fields.
function topLevelRulesAreV2Shaped(raw: RawFeatureDoc): boolean {
  const rules = raw.rules;
  if (!Array.isArray(rules)) return false;
  return rules.some(
    (r) =>
      r &&
      typeof r === "object" &&
      ("allEnvironments" in r || "environments" in r),
  );
}

function classifyFeatureDocShape(raw: RawFeatureDoc): FeatureDocShape {
  // v0 is identified by the absence of `environmentSettings`
  // (mirrors `migrateRawFeatureToV2`).
  if (!raw.environmentSettings) return "v0";
  const hasLegacyEnvRules = legacyEnvRulesEnvs(raw).length > 0;
  if (topLevelRulesAreV2Shaped(raw)) {
    return hasLegacyEnvRules ? "mixed" : "v2";
  }
  if (hasLegacyEnvRules) return "v1";
  // No env-scoped top-level rules and no per-env rules left on disk. With
  // top-level rules present this is a v0/v1 hybrid; with none it's
  // indistinguishable from (and equivalent to) a clean v2 doc.
  return Array.isArray(raw.rules) && raw.rules.length > 0 ? "v1" : "v2";
}

// Per-env rule projection used for drift detection. Same comparison the
// GET-path drift repair uses.
function envRules(rules: FeatureRule[], env: string): FeatureRule[] {
  return getRulesForEnvironment(rules, env);
}

// Detect drift between the live revision (source of truth) and the persisted
// `feature.rules` / `feature.defaultValue`. If found, repair in place by
// re-writing through `updateFeature` — which scrubs legacy
// `environmentSettings.{env}.rules` so the JIT read-time migration stops
// re-flattening them and shadowing the v2 top-level rules.
//
// Idempotent and converges in one round-trip. Mutates `feature` so callers in
// the same request see the repaired state without re-reading.
//
// Used by the GET-path self-heal (feature page load, publish, revert) and by
// the admin feature-repair apply path.
export async function repairFeatureDriftIfNeeded(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
  live: FeatureRevisionInterface | undefined,
  environmentIds: string[],
  { throwOnFailure = false }: { throwOnFailure?: boolean } = {},
): Promise<void> {
  if (!live) return;

  const liveRulesFlat: FeatureRule[] = live.rules ?? [];
  const featureRulesFlat: FeatureRule[] = feature.rules ?? [];
  const defaultValueDrift = live.defaultValue !== feature.defaultValue;
  const driftedEnvs = environmentIds.filter(
    (env) =>
      !isEqual(
        getRulesForEnvironment(featureRulesFlat, env),
        getRulesForEnvironment(liveRulesFlat, env),
      ),
  );

  if (!defaultValueDrift && driftedEnvs.length === 0) return;

  logger.warn(
    {
      featureId: feature.id,
      orgId: context.org.id,
      defaultValueDrift,
      driftedEnvs,
    },
    "Repairing feature drift against live revision",
  );

  try {
    const original = { ...feature };
    const repaired = await updateFeature(context, feature, {
      ...(defaultValueDrift ? { defaultValue: live.defaultValue } : {}),
      rules: liveRulesFlat,
    });
    Object.assign(feature, repaired);

    // Record the repair in the audit history so automated rewrites are
    // visible and searchable (`context.autoRepair` in details). Non-fatal:
    // an audit write failure must not abort a publish/revert whose repair
    // succeeded.
    try {
      await context.auditLog({
        event: "feature.update",
        entity: {
          object: "feature",
          id: feature.id,
        },
        details: auditDetailsUpdate(original, repaired, {
          autoRepair: true,
          note: "Automatic drift repair: feature did not match its live revision and was rewritten from it",
          liveRevisionVersion: live.version,
          defaultValueDrift,
          driftedEnvs,
        }),
      });
    } catch (auditError) {
      logger.error(
        { err: auditError, featureId: feature.id, orgId: context.org.id },
        "Failed to write audit entry for feature drift repair",
      );
    }
  } catch (e) {
    logger.error(
      { err: e, featureId: feature.id, orgId: context.org.id },
      "Failed to repair feature drift",
    );
    // Write callers (publish, revert) MUST abort if the repair fails —
    // otherwise the subsequent diff runs against the stale `feature.rules`
    // and the operation silently no-ops or produces an incorrect merge
    // (the exact failure this helper exists to prevent). Read callers
    // (e.g. getFeatureById) tolerate the stale response.
    if (throwOnFailure) {
      throw new Error(
        "Could not reconcile feature with its live revision. Please retry.",
      );
    }
  }
}

async function fetchRevisionDocsForFeatures(
  organization: string,
  features: { id: string; version: number }[],
): Promise<{
  liveByFeature: Map<string, RawRevisionDoc>;
  publishedVersionsByFeature: Map<string, number[]>;
  draftsByFeature: Map<string, RawRevisionDoc[]>;
}> {
  const coll = getCollection<RawRevisionDoc>(REVISIONS_COLLECTION);
  const ids = features.map((f) => f.id);

  const [liveDocs, publishedDocs, draftDocs] = await Promise.all([
    coll
      .find({
        organization,
        $or: features.map((f) => ({ featureId: f.id, version: f.version })),
      })
      .project({ log: 0 })
      .toArray(),
    coll
      .find({ organization, featureId: { $in: ids }, status: "published" })
      .project({ featureId: 1, version: 1 })
      .toArray(),
    coll
      .find({
        organization,
        featureId: { $in: ids },
        status: { $in: [...ACTIVE_DRAFT_STATUSES] },
      })
      .project({ log: 0 })
      .toArray(),
  ]);

  const liveByFeature = new Map<string, RawRevisionDoc>();
  for (const doc of liveDocs) {
    liveByFeature.set(doc.featureId, doc as RawRevisionDoc);
  }

  const versionByFeature = new Map(features.map((f) => [f.id, f.version]));
  const publishedVersionsByFeature = new Map<string, number[]>();
  for (const doc of publishedDocs) {
    const featureVersion = versionByFeature.get(doc.featureId);
    if (featureVersion === undefined || doc.version <= featureVersion) {
      continue;
    }
    const list = publishedVersionsByFeature.get(doc.featureId) ?? [];
    list.push(doc.version);
    publishedVersionsByFeature.set(doc.featureId, list);
  }

  const draftsByFeature = new Map<string, RawRevisionDoc[]>();
  for (const doc of draftDocs) {
    const list = draftsByFeature.get(doc.featureId) ?? [];
    list.push(doc as RawRevisionDoc);
    draftsByFeature.set(doc.featureId, list);
  }

  return { liveByFeature, publishedVersionsByFeature, draftsByFeature };
}

/** How a wiped env's rules get restored into a corrupt draft */
export interface DraftEnvRepairPlan {
  env: string;
  /**
   * "replay": the draft's edit logs were unambiguous, so the env's intended
   * rules were reconstructed by replaying them on top of the draft's base
   * revision. "live": logs were absent/ambiguous; restore the env's rules
   * from the current live serving state instead.
   */
  source: "replay" | "live";
  /** Replay succeeded but rule ORDER within the env may differ (e.g. "move rule" entries use flat positions we can't map) */
  orderUncertain: boolean;
  /** Why replay wasn't usable (when source is "live") */
  reason: string | null;
  rules: FeatureRule[];
}

interface AnalyzedFeature {
  finding: FeatureRepairFinding;
  raw: RawFeatureDoc;
  migrated: FeatureInterface;
  liveRevisionRaw: RawRevisionDoc | null;
  liveRevisionMigrated: FeatureRevisionInterface | null;
  draftsRaw: RawRevisionDoc[];
  /** Keyed by corrupt draft version */
  draftRepairPlans: Map<number, DraftEnvRepairPlan[]>;
}

const REVISION_LOGS_COLLECTION = "featurerevisionlog";

interface RevisionLogEntryLike {
  action?: unknown;
  subject?: unknown;
  value?: unknown;
  /** Embedded log entries carry `timestamp`; collection docs carry `dateCreated` */
  timestamp?: unknown;
  dateCreated?: unknown;
}

interface NormalizedLogEntry {
  ts: number;
  action: string;
  subject: string;
  value: string;
}

function normalizeLogEntry(entry: RevisionLogEntryLike): NormalizedLogEntry {
  const rawTs = entry.timestamp ?? entry.dateCreated;
  const ts =
    rawTs instanceof Date
      ? rawTs.getTime()
      : typeof rawTs === "string"
        ? new Date(rawTs).getTime() || 0
        : 0;
  return {
    ts,
    action: typeof entry.action === "string" ? entry.action : "",
    subject: typeof entry.subject === "string" ? entry.subject : "",
    value: typeof entry.value === "string" ? entry.value : "",
  };
}

/**
 * Counts "delete rule" log events attributable to each environment. The env
 * info in delete logs varies by write path: the UI logs the full deleted rule
 * (with `environments`/`allEnvironments`), the v1 API logs `{ environment }`,
 * and the v2 API logs `{}`. Entries that don't identify an env count as
 * wildcards usable by any env (generous — keeps intentional cleanups from
 * being flagged at the cost of slightly weaker corruption detection).
 */
function deleteEventCounts(logs: RevisionLogEntryLike[]): {
  byEnv: Map<string, number>;
  wildcard: number;
} {
  const byEnv = new Map<string, number>();
  let wildcard = 0;
  for (const entry of logs) {
    if (entry.action !== "delete rule") continue;
    let parsed: unknown = null;
    if (typeof entry.value === "string" && entry.value.length > 0) {
      try {
        parsed = JSON.parse(entry.value);
      } catch {
        // unparsable value — treat as wildcard below
      }
    }
    const obj =
      parsed !== null && typeof parsed === "object"
        ? (parsed as Record<string, unknown>)
        : {};
    if (typeof obj.environment === "string") {
      byEnv.set(obj.environment, (byEnv.get(obj.environment) ?? 0) + 1);
    } else if (
      obj.allEnvironments !== true &&
      Array.isArray(obj.environments) &&
      obj.environments.length > 0
    ) {
      for (const env of obj.environments) {
        if (typeof env === "string") {
          byEnv.set(env, (byEnv.get(env) ?? 0) + 1);
        }
      }
    } else {
      wildcard++;
    }
  }
  return { byEnv, wildcard };
}

function subjectRuleId(subject: string): string {
  // UI delete logs use subject "rule {id}"; the API endpoints log the bare id
  return subject.startsWith("rule ") ? subject.slice("rule ".length) : subject;
}

function ruleTouchesEnv(rule: FeatureRule, env: string): boolean {
  if (rule.allEnvironments === true) return true;
  return Array.isArray(rule.environments) && rule.environments.includes(env);
}

// Log actions that never change a draft's rules — safe to skip during replay
const REPLAY_IGNORED_ACTIONS = new Set([
  // creation snapshot; replay seeds from the base revision instead (the
  // snapshot of a corrupted draft is the corruption itself)
  "new revision",
  "discard",
  "edit comment",
  "edit title",
  "edit metadata",
  "edit prerequisites",
  "edit default value",
  "set ramp schedule",
  "clear ramp schedule",
]);

/**
 * Reconstructs one environment's intended rules for a draft by replaying its
 * edit logs on top of a seed (the env's rules from the draft's base
 * revision). Strictly bails on anything ambiguous: every rule-affecting log
 * entry must be deterministically interpretable for this env, otherwise the
 * caller falls back to restoring from the live state.
 *
 * Replayable: "add rule" / "edit rule" variants (full rule JSON logged by
 * every write path), "delete rule" (rule id from subject or value; v1 logs
 * `{environment}` for env-scoped deletes), "reorder rules" (rule-id order).
 * Order-uncertain: "move rule" (logs flat-array positions that can't be
 * mapped into a single env's order — content is still exact).
 * Bails on: "rebase", "merged", generic "update", or anything unrecognized,
 * since those can rewrite rules wholesale.
 */
function replayEnvRules(
  env: string,
  seedRules: FeatureRule[],
  entries: NormalizedLogEntry[],
): { rules: FeatureRule[]; orderUncertain: boolean } | { ambiguous: string } {
  let state: FeatureRule[] = cloneDeep(seedRules);
  let orderUncertain = false;

  const parse = (value: string): unknown => {
    if (!value) return null;
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  };

  for (const entry of [...entries].sort((a, b) => a.ts - b.ts)) {
    const { action, subject, value } = entry;
    if (REPLAY_IGNORED_ACTIONS.has(action)) continue;
    if (action === "update" && subject === "json schema") continue;

    if (/^(add( experiment)? rule|edit rule)/.test(action)) {
      const rule = parse(value) as FeatureRule | null;
      if (!rule || typeof rule !== "object" || typeof rule.id !== "string") {
        return { ambiguous: `"${action}" entry has no parsable rule` };
      }
      const idx = state.findIndex((r) => r.id === rule.id);
      if (ruleTouchesEnv(rule, env)) {
        if (idx >= 0) state[idx] = rule;
        else state.push(rule);
      } else if (idx >= 0 && action.startsWith("edit rule")) {
        // The edit removed this env from the rule's footprint
        state.splice(idx, 1);
      }
      continue;
    }

    if (action === "delete rule") {
      const parsed = parse(value);
      const obj =
        parsed !== null && typeof parsed === "object"
          ? (parsed as Record<string, unknown>)
          : {};
      if (typeof obj.environment === "string") {
        // v1 env-scoped delete: only narrows the rule in that one env
        if (obj.environment !== env) continue;
        const id = subjectRuleId(subject);
        state = state.filter((r) => r.id !== id);
        continue;
      }
      const id = typeof obj.id === "string" ? obj.id : subjectRuleId(subject);
      if (!id) {
        return { ambiguous: '"delete rule" entry has no rule id' };
      }
      // Full delete; a rule outside this env is simply not in our state
      state = state.filter((r) => r.id !== id);
      continue;
    }

    if (action === "reorder rules") {
      // v1 logs the env id as subject with the env's rule-id order; v2 logs
      // "all environments" with the flat order (which induces env order)
      if (subject !== env && subject !== "all environments") continue;
      const ids = parse(value);
      if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) {
        return { ambiguous: '"reorder rules" entry has no parsable order' };
      }
      const pos = new Map(ids.map((id, i) => [id, i] as const));
      // Stable sort: ids missing from the logged order keep relative position
      state = [...state].sort(
        (a, b) =>
          (pos.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
          (pos.get(b.id) ?? Number.MAX_SAFE_INTEGER),
      );
      continue;
    }

    if (action === "move rule") {
      // Logged with flat-array positions we can't map into one env's order.
      // Rule content is unaffected; only ordering confidence drops.
      orderUncertain = true;
      continue;
    }

    return { ambiguous: `non-replayable "${action}" entry` };
  }

  return { rules: state, orderUncertain };
}

/**
 * Second pass over drafts that empty serving envs:
 * 1. If the draft's logs contain enough "delete rule" events to account for
 *    every rule the env lost, the wipe was almost certainly intentional
 *    (every UI/API deletion logs; the corrupting sparse v1 rebuilds wrote
 *    nothing). Downgrade to `emptiedDraftsWithHistory` — never touched.
 * 2. For drafts that stay corrupt, compute a per-env repair plan: replay the
 *    edit logs when they're unambiguous (preserving the author's intended
 *    edits), otherwise fall back to restoring the env from the live state.
 */
async function classifyAndPlanCorruptDrafts(
  context: ReqContext | ApiReqContext,
  organization: string,
  analyzed: AnalyzedFeature[],
): Promise<void> {
  const revisionColl = getCollection<RawRevisionDoc>(REVISIONS_COLLECTION);

  for (const a of analyzed) {
    if (a.finding.corruptDrafts.length === 0) continue;
    const featureId = a.finding.featureId;
    const versions = a.finding.corruptDrafts.map((d) => d.version);

    // Logs live in the `featurerevisionlog` collection for newer edits and
    // in the embedded `log` array on the revision doc for older ones.
    const [logDocs, revisionDocs] = await Promise.all([
      getCollection<Record<string, unknown>>(REVISION_LOGS_COLLECTION)
        .find({ organization, featureId, version: { $in: versions } })
        .project({
          action: 1,
          subject: 1,
          value: 1,
          version: 1,
          dateCreated: 1,
        })
        .toArray(),
      getCollection<RawRevisionDoc>(REVISIONS_COLLECTION)
        .find({ organization, featureId, version: { $in: versions } })
        .project({ version: 1, log: 1 })
        .toArray(),
    ]);

    const logsByVersion = new Map<number, RevisionLogEntryLike[]>();
    const push = (version: number, entries: RevisionLogEntryLike[]) => {
      const list = logsByVersion.get(version) ?? [];
      list.push(...entries);
      logsByVersion.set(version, list);
    };
    for (const doc of logDocs) {
      push(doc.version as number, [doc as RevisionLogEntryLike]);
    }
    for (const doc of revisionDocs) {
      const embedded = doc.log;
      if (Array.isArray(embedded)) {
        push(doc.version, embedded as RevisionLogEntryLike[]);
      }
    }

    const migratedRules: FeatureRule[] = a.migrated.rules ?? [];
    const stillCorrupt: FeatureRepairFinding["corruptDrafts"] = [];
    const accounted: FeatureRepairFinding["emptiedDraftsWithHistory"] = [];

    for (const draft of a.finding.corruptDrafts) {
      const rawEntries = logsByVersion.get(draft.version) ?? [];
      const { byEnv, wildcard } = deleteEventCounts(rawEntries);
      const allEnvsAccounted = draft.wipedEnvs.every(
        (env) =>
          (byEnv.get(env) ?? 0) + wildcard >=
          envRules(migratedRules, env).length,
      );
      if (allEnvsAccounted) {
        accounted.push(draft);
        continue;
      }
      stillCorrupt.push(draft);

      // Seed for replay: the revision the draft forked from
      const draftRaw = a.draftsRaw.find((d) => d.version === draft.version);
      const baseVersion =
        typeof draftRaw?.baseVersion === "number" ? draftRaw.baseVersion : null;
      let seedRules: FeatureRule[] | null = null;
      if (baseVersion !== null) {
        if (
          a.liveRevisionMigrated &&
          baseVersion === a.liveRevisionMigrated.version
        ) {
          seedRules = a.liveRevisionMigrated.rules ?? [];
        } else {
          const baseRaw = await revisionColl.findOne({
            organization,
            featureId,
            version: baseVersion,
          });
          if (baseRaw) {
            seedRules =
              buildFeatureRevisionInterface(
                cloneDeep(omit(baseRaw, ["_id", "__v"])) as RawRevisionDoc,
                context,
                a.migrated,
              ).rules ?? [];
          }
        }
      }

      const entries = rawEntries.map(normalizeLogEntry);
      const plans: DraftEnvRepairPlan[] = [];
      for (const env of draft.wipedEnvs) {
        const liveEnvRules = envRules(migratedRules, env);
        let plan: DraftEnvRepairPlan;
        if (seedRules !== null) {
          const replayed = replayEnvRules(
            env,
            envRules(seedRules, env),
            entries,
          );
          plan =
            "ambiguous" in replayed
              ? {
                  env,
                  source: "live",
                  orderUncertain: false,
                  reason: replayed.ambiguous,
                  rules: liveEnvRules,
                }
              : {
                  env,
                  source: "replay",
                  orderUncertain: replayed.orderUncertain,
                  reason: null,
                  rules: replayed.rules,
                };
        } else {
          plan = {
            env,
            source: "live",
            orderUncertain: false,
            reason: "draft's base revision is unavailable",
            rules: liveEnvRules,
          };
        }
        plans.push(plan);
      }
      a.draftRepairPlans.set(draft.version, plans);
      draft.envPlans = plans.map((p) => ({
        env: p.env,
        source: p.source,
        orderUncertain: p.orderUncertain,
        reason: p.reason,
        ruleCount: p.rules.length,
      }));
    }

    a.finding.corruptDrafts = stillCorrupt;
    a.finding.emptiedDraftsWithHistory = accounted;
  }
}

function analyzeFeature(
  context: ReqContext | ApiReqContext,
  raw: RawFeatureDoc,
  liveRevisionRaw: RawRevisionDoc | undefined,
  phantomPublishedVersions: number[],
  drafts: RawRevisionDoc[],
): AnalyzedFeature {
  const migrated = migrateRawFeatureToV2(cloneDeep(raw), context);
  const migratedRules: FeatureRule[] = migrated.rules ?? [];
  const orgEnvs = getEnvironments(context.org);
  const applicableEnvs = getApplicableEnvIds(orgEnvs, migrated.project);

  const legacyEnvRules = legacyEnvRulesEnvs(raw);
  const nonV2TopLevelRules =
    migratedRules.length > 0 && !topLevelRulesAreV2Shaped(raw);

  const liveRevisionMigrated = liveRevisionRaw
    ? buildFeatureRevisionInterface(
        cloneDeep(omit(liveRevisionRaw, ["_id", "__v"])) as RawRevisionDoc,
        context,
        migrated,
      )
    : null;
  const legacyLiveRevisionDoc =
    !!liveRevisionRaw && !isV2RevisionRules(liveRevisionRaw.rules);

  let drift: FeatureRepairFinding["drift"] = null;
  if (liveRevisionMigrated) {
    const liveRules: FeatureRule[] = liveRevisionMigrated.rules ?? [];
    const defaultValueDrift =
      liveRevisionMigrated.defaultValue !== migrated.defaultValue;
    const driftedEnvs = applicableEnvs.filter(
      (env) => !isEqual(envRules(migratedRules, env), envRules(liveRules, env)),
    );
    if (defaultValueDrift || driftedEnvs.length > 0) {
      // Direction: production GET self-heal rewrites the feature from its
      // live revision, so default to that. But never let the repair REMOVE
      // serving rules: if any drifted env has rules on the feature and none
      // on the revision, the revision side is the sparse/suspect one — sync
      // the revision from the feature instead.
      const revisionLooksSparse = driftedEnvs.some(
        (env) =>
          envRules(migratedRules, env).length > 0 &&
          envRules(liveRules, env).length === 0,
      );
      drift = {
        defaultValue: defaultValueDrift,
        envs: driftedEnvs,
        direction: revisionLooksSparse
          ? "revision_from_feature"
          : "feature_from_revision",
      };
    }
  }

  const corruptDrafts: FeatureRepairFinding["corruptDrafts"] = [];
  for (const draftRaw of drafts) {
    const draft = buildFeatureRevisionInterface(
      cloneDeep(omit(draftRaw, ["_id", "__v"])) as RawRevisionDoc,
      context,
      migrated,
    );
    const draftRules: FeatureRule[] = draft.rules ?? [];
    const wipedEnvs = applicableEnvs.filter(
      (env) =>
        envRules(migratedRules, env).length > 0 &&
        envRules(draftRules, env).length === 0,
    );
    if (wipedEnvs.length > 0) {
      corruptDrafts.push({ version: draft.version, wipedEnvs, envPlans: [] });
    }
  }

  return {
    finding: {
      featureId: migrated.id,
      version: migrated.version,
      project: migrated.project ?? "",
      archived: migrated.archived ?? false,
      dateUpdated: migrated.dateUpdated ?? null,
      featureDocShape: classifyFeatureDocShape(raw),
      liveRevisionDocShape: liveRevisionRaw
        ? legacyLiveRevisionDoc
          ? "v1"
          : "v2"
        : null,
      legacyEnvRulesOnDisk: legacyEnvRules,
      nonV2TopLevelRules,
      missingLiveRevision: !liveRevisionRaw,
      legacyLiveRevisionDoc,
      drift,
      phantomPublishedVersions,
      corruptDrafts,
      emptiedDraftsWithHistory: [],
    },
    raw,
    migrated,
    liveRevisionRaw: liveRevisionRaw ?? null,
    liveRevisionMigrated,
    draftsRaw: drafts,
    draftRepairPlans: new Map(),
  };
}

function findingNeedsAttention(finding: FeatureRepairFinding): boolean {
  return (
    finding.legacyEnvRulesOnDisk.length > 0 ||
    finding.nonV2TopLevelRules ||
    finding.missingLiveRevision ||
    finding.legacyLiveRevisionDoc ||
    finding.drift !== null ||
    finding.phantomPublishedVersions.length > 0 ||
    finding.corruptDrafts.length > 0 ||
    finding.emptiedDraftsWithHistory.length > 0 ||
    finding.analysisError === true
  );
}

async function analyzeOrgFeatures(
  context: ReqContext | ApiReqContext,
  { featureIds }: { featureIds?: string[] } = {},
): Promise<{ featuresScanned: number; analyzed: AnalyzedFeature[] }> {
  const organization = context.org.id;
  const query: Record<string, unknown> = { organization };
  // `undefined` = all features; an explicit empty array = none ($in: []
  // matches nothing) so a caller can't accidentally repair the whole org.
  if (featureIds) {
    query.id = { $in: featureIds };
  }

  const rawDocs = (await FeatureModel.find(query)
    .sort({ id: 1 })
    .lean()) as unknown as RawFeatureDoc[];

  const analyzed: AnalyzedFeature[] = [];
  for (const batch of chunk(rawDocs, FEATURE_BATCH_SIZE)) {
    const { liveByFeature, publishedVersionsByFeature, draftsByFeature } =
      await fetchRevisionDocsForFeatures(
        organization,
        batch.map((f) => ({ id: f.id, version: f.version || 1 })),
      );

    for (const raw of batch) {
      try {
        const result = analyzeFeature(
          context,
          raw,
          liveByFeature.get(raw.id),
          (publishedVersionsByFeature.get(raw.id) ?? []).sort((a, b) => a - b),
          draftsByFeature.get(raw.id) ?? [],
        );
        if (findingNeedsAttention(result.finding)) {
          analyzed.push(result);
        }
      } catch (e) {
        logger.error(
          { err: e, featureId: raw.id, orgId: organization },
          "Feature repair analysis failed for feature",
        );
        analyzed.push({
          finding: {
            featureId: raw.id,
            version: raw.version || 1,
            project: (raw.project as string) ?? "",
            archived: !!raw.archived,
            dateUpdated: (raw.dateUpdated as Date) ?? null,
            featureDocShape: classifyFeatureDocShape(raw),
            liveRevisionDocShape: null,
            legacyEnvRulesOnDisk: [],
            nonV2TopLevelRules: false,
            missingLiveRevision: false,
            legacyLiveRevisionDoc: false,
            drift: null,
            phantomPublishedVersions: [],
            corruptDrafts: [],
            emptiedDraftsWithHistory: [],
            analysisError: true,
          },
          raw,
          migrated: raw as unknown as FeatureInterface,
          liveRevisionRaw: null,
          liveRevisionMigrated: null,
          draftsRaw: [],
          draftRepairPlans: new Map(),
        });
      }
    }
  }

  await classifyAndPlanCorruptDrafts(context, organization, analyzed);

  return { featuresScanned: rawDocs.length, analyzed };
}

export async function scanOrgFeatureRepairs(
  context: ReqContext | ApiReqContext,
): Promise<FeatureRepairScanResult> {
  const { featuresScanned, analyzed } = await analyzeOrgFeatures(context);
  const findings = analyzed.map((a) => a.finding);

  return {
    featuresScanned,
    findings,
    summary: {
      featuresFlagged: findings.length,
      legacyEnvRulesOnDisk: findings.filter(
        (f) => f.legacyEnvRulesOnDisk.length > 0,
      ).length,
      nonV2TopLevelRules: findings.filter((f) => f.nonV2TopLevelRules).length,
      missingLiveRevision: findings.filter((f) => f.missingLiveRevision).length,
      legacyLiveRevisionDoc: findings.filter((f) => f.legacyLiveRevisionDoc)
        .length,
      drift: findings.filter((f) => f.drift !== null).length,
      phantomPublishedRevisions: findings.reduce(
        (sum, f) => sum + f.phantomPublishedVersions.length,
        0,
      ),
      corruptDrafts: findings.reduce(
        (sum, f) => sum + f.corruptDrafts.length,
        0,
      ),
      emptiedDraftsWithHistory: findings.reduce(
        (sum, f) => sum + f.emptiedDraftsWithHistory.length,
        0,
      ),
    },
  };
}

function buildProposal(a: AnalyzedFeature): FeatureRepairProposal {
  const { finding, raw, migrated, liveRevisionMigrated } = a;
  const notes: string[] = [];

  let featureRules: FeatureRepairProposal["feature"]["rules"] = null;
  let featureDefaultValue: FeatureRepairProposal["feature"]["defaultValue"] =
    null;

  if (finding.drift?.direction === "feature_from_revision") {
    const targetRules = liveRevisionMigrated?.rules ?? [];
    featureRules = { before: raw.rules ?? null, after: targetRules };
    if (finding.drift.defaultValue && liveRevisionMigrated) {
      featureDefaultValue = {
        before: migrated.defaultValue,
        after: liveRevisionMigrated.defaultValue,
      };
    }
    notes.push(
      "Fix drift: feature doc rewritten from its live revision (the same self-heal production runs on GET)",
    );
  } else if (finding.drift?.direction === "revision_from_feature") {
    notes.push(
      "Fix drift will SKIP this feature: the live revision looks sparse and repairing from it would wipe serving rules — needs manual review",
    );
  }

  for (const draft of finding.corruptDrafts) {
    const planDesc =
      draft.envPlans && draft.envPlans.length > 0
        ? draft.envPlans
            .map((p) =>
              p.source === "replay"
                ? `${p.env}: ${p.ruleCount} rule(s) replayed from edit logs${
                    p.orderUncertain ? " (rule order uncertain)" : ""
                  }`
                : `${p.env}: ${p.ruleCount} rule(s) restored from live state (${
                    p.reason ?? "logs not replayable"
                  })`,
            )
            .join("; ")
        : "no repair plan computed";
    notes.push(
      `Repair corrupt draft v${draft.version}: ${planDesc}. Other draft edits preserved; status back to "draft".`,
    );
  }

  for (const draft of finding.emptiedDraftsWithHistory) {
    notes.push(
      `Reported only: draft v${draft.version} empties ${draft.wipedEnvs.join(
        ", ",
      )} but has matching rule-delete history (likely intentional; not reset)`,
    );
  }

  if (finding.missingLiveRevision) {
    notes.push(
      "Reported only: no revision doc exists at the feature's live version (not auto-fixed)",
    );
  }

  if (finding.phantomPublishedVersions.length > 0) {
    notes.push(
      `Reported only: v${finding.phantomPublishedVersions.join(
        ", v",
      )} marked published but never applied (not auto-fixed)`,
    );
  }

  if (
    finding.legacyEnvRulesOnDisk.length > 0 ||
    finding.nonV2TopLevelRules ||
    finding.legacyLiveRevisionDoc
  ) {
    notes.push(
      "Benign legacy storage shapes present (handled transparently by the read path; not modified)",
    );
  }

  if (finding.analysisError) {
    notes.push(
      "Analysis FAILED for this feature — findings are unreliable and no repair will be attempted; check server logs",
    );
  }

  return {
    finding,
    feature: {
      rules: featureRules,
      defaultValue: featureDefaultValue,
    },
    notes,
  };
}

export async function planOrgFeatureRepairs(
  context: ReqContext | ApiReqContext,
  {
    page = 1,
    limit = 10,
    featureIds,
  }: { page?: number; limit?: number; featureIds?: string[] },
): Promise<{
  total: number;
  page: number;
  limit: number;
  proposals: FeatureRepairProposal[];
}> {
  const { analyzed } = await analyzeOrgFeatures(context, { featureIds });
  const start = (page - 1) * limit;
  const pageItems = analyzed.slice(start, start + limit);

  return {
    total: analyzed.length,
    page,
    limit,
    proposals: pageItems.map(buildProposal),
  };
}

export async function applyOrgFeatureRepairs(
  context: ReqContext | ApiReqContext,
  {
    featureIds,
    repairedBy,
    mode,
  }: { featureIds?: string[]; repairedBy: string; mode: FeatureRepairMode },
): Promise<FeatureRepairApplyResult[]> {
  const organization = context.org.id;
  const { analyzed } = await analyzeOrgFeatures(context, { featureIds });
  const revisionColl = getCollection<RawRevisionDoc>(REVISIONS_COLLECTION);
  const results: FeatureRepairApplyResult[] = [];

  for (const a of analyzed) {
    const { finding, migrated, liveRevisionMigrated } = a;
    const actions: string[] = [];
    let wrote = false;
    try {
      const now = new Date();

      if (mode === "drift") {
        if (
          finding.drift?.direction === "feature_from_revision" &&
          liveRevisionMigrated
        ) {
          // The exact same self-heal the GET/publish paths run: rewrite the
          // feature doc from its live revision (audit-logged inside).
          const applicableEnvs = getApplicableEnvIds(
            getEnvironments(context.org),
            migrated.project,
          );
          await repairFeatureDriftIfNeeded(
            context,
            migrated,
            liveRevisionMigrated,
            applicableEnvs,
            { throwOnFailure: true },
          );
          actions.push("rewrote feature from live revision (drift self-heal)");
          wrote = true;
        } else if (finding.drift?.direction === "revision_from_feature") {
          actions.push(
            "skipped: live revision looks sparse — repairing from it would wipe serving rules; needs manual review",
          );
        }
      }

      if (mode === "corruptDrafts") {
        for (const draft of finding.corruptDrafts) {
          const plans = a.draftRepairPlans.get(draft.version) ?? [];
          const draftRaw = a.draftsRaw.find((d) => d.version === draft.version);
          if (plans.length === 0 || !draftRaw) {
            actions.push(
              `skipped draft v${draft.version}: no repair plan computed`,
            );
            continue;
          }

          // Env-scoped repair: only the wiped envs get rules restored
          // (replayed from edit logs when unambiguous, else from the live
          // state). Everything else in the draft — other envs' rules,
          // defaultValue, prerequisites — is preserved.
          const draftMigrated = buildFeatureRevisionInterface(
            cloneDeep(omit(draftRaw, ["_id", "__v"])) as RawRevisionDoc,
            context,
            migrated,
          );
          // When every applicable env was wiped there is no surviving
          // per-env draft state to protect, so restored `allEnvironments`
          // rules can keep their original scope. If only SOME envs were
          // wiped, restored rules are narrowed to the wiped env — granting
          // a broader footprint could override intentional draft edits in
          // the surviving envs.
          const applicableEnvs = getApplicableEnvIds(
            getEnvironments(context.org),
            migrated.project,
          );
          const wipedSet = new Set(draft.wipedEnvs);
          const allApplicableWiped = applicableEnvs.every((e) =>
            wipedSet.has(e),
          );

          const newRules: FeatureRule[] = cloneDeep(draftMigrated.rules ?? []);
          for (const plan of plans) {
            for (const rule of plan.rules) {
              const existing = newRules.find((r) => r.id === rule.id);
              if (existing) {
                if (!ruleTouchesEnv(existing, plan.env)) {
                  existing.environments = [
                    ...(existing.environments ?? []),
                    plan.env,
                  ];
                }
              } else if (rule.allEnvironments === true && allApplicableWiped) {
                newRules.push(cloneDeep(rule));
              } else {
                newRules.push({
                  ...cloneDeep(rule),
                  allEnvironments: false,
                  environments: [plan.env],
                });
              }
            }
          }

          const planSummary = plans
            .map(
              (p) =>
                `${p.env} (${
                  p.source === "replay"
                    ? "replayed from edit logs"
                    : "restored from live state"
                })`,
            )
            .join(", ");

          const existingComment =
            typeof draftRaw.comment === "string" &&
            draftRaw.comment.trim().length > 0
              ? `${draftRaw.comment}\n`
              : "";
          // Status drops back to "draft" so any review/approval of the
          // corrupt content is voided.
          await revisionColl.updateOne(
            { organization, featureId: migrated.id, version: draft.version },
            {
              $set: {
                rules: newRules,
                status: "draft",
                dateUpdated: now,
                comment: `${existingComment}[admin repair by ${repairedBy}] A corrupted write removed all rules from: ${draft.wipedEnvs.join(
                  ", ",
                )}. Restored ${planSummary}; other draft edits were preserved. Please verify before publishing.`,
              },
            },
          );
          actions.push(`repaired draft v${draft.version}: ${planSummary}`);
          wrote = true;
        }
      }

      results.push({
        featureId: migrated.id,
        status: wrote ? "repaired" : "skipped",
        actions,
      });
    } catch (e) {
      logger.error(
        { err: e, featureId: finding.featureId, orgId: organization },
        "Admin feature repair failed for feature",
      );
      results.push({
        featureId: finding.featureId,
        status: "error",
        actions,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return results;
}
