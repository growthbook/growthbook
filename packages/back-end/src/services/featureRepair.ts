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
  /** Active drafts whose rules empty out envs that currently serve rules (report-only) */
  corruptDrafts: { version: number; wipedEnvs: string[] }[];
}

export interface FeatureRepairProposal {
  finding: FeatureRepairFinding;
  feature: {
    rules: { before: unknown; after: FeatureRule[] } | null;
    defaultValue: { before: string; after: string } | null;
    /** Envs whose legacy rules key gets scrubbed from disk */
    scrubEnvRules: string[];
  };
  liveRevision: {
    version: number;
    rules: { before: unknown; after: FeatureRule[] };
    defaultValue: { before: unknown; after: string };
  } | null;
  createLiveRevision: { version: number } | null;
  discardRevisions: number[];
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

interface AnalyzedFeature {
  finding: FeatureRepairFinding;
  raw: RawFeatureDoc;
  migrated: FeatureInterface;
  liveRevisionRaw: RawRevisionDoc | null;
  liveRevisionMigrated: FeatureRevisionInterface | null;
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
      corruptDrafts.push({ version: draft.version, wipedEnvs });
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
    },
    raw,
    migrated,
    liveRevisionRaw: liveRevisionRaw ?? null,
    liveRevisionMigrated,
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
    finding.corruptDrafts.length > 0
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
          },
          raw,
          migrated: raw as unknown as FeatureInterface,
          liveRevisionRaw: null,
          liveRevisionMigrated: null,
        });
      }
    }
  }

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
    },
  };
}

function buildProposal(a: AnalyzedFeature): FeatureRepairProposal {
  const { finding, raw, migrated, liveRevisionRaw, liveRevisionMigrated } = a;
  const notes: string[] = [];

  let featureRules: FeatureRepairProposal["feature"]["rules"] = null;
  let featureDefaultValue: FeatureRepairProposal["feature"]["defaultValue"] =
    null;

  const needsCanonicalWrite =
    finding.legacyEnvRulesOnDisk.length > 0 || finding.nonV2TopLevelRules;

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
      "Feature doc rewritten from its live revision (same as production self-heal)",
    );
  } else if (needsCanonicalWrite) {
    featureRules = { before: raw.rules ?? null, after: migrated.rules ?? [] };
    notes.push(
      "Feature doc persisted in canonical v2 shape (no serving change)",
    );
  }

  let liveRevision: FeatureRepairProposal["liveRevision"] = null;
  if (finding.drift?.direction === "revision_from_feature" && liveRevisionRaw) {
    liveRevision = {
      version: liveRevisionRaw.version,
      rules: { before: liveRevisionRaw.rules, after: migrated.rules ?? [] },
      defaultValue: {
        before: liveRevisionRaw.defaultValue,
        after: migrated.defaultValue,
      },
    };
    notes.push(
      "Live revision doc synced from the feature (revision was sparse; feature's serving state preserved)",
    );
    if (needsCanonicalWrite) {
      featureRules = { before: raw.rules ?? null, after: migrated.rules ?? [] };
      notes.push(
        "Feature doc persisted in canonical v2 shape (no serving change)",
      );
    }
  }

  if (finding.missingLiveRevision) {
    notes.push("Live revision doc missing; will be created from the feature");
  }

  if (finding.phantomPublishedVersions.length > 0) {
    notes.push(
      "Revisions marked published above the feature's version were never applied; will be discarded with a note",
    );
  }

  if (finding.corruptDrafts.length > 0) {
    notes.push(
      "Active draft(s) would empty rules in currently-serving envs — flagged for manual review, NOT auto-discarded",
    );
  }

  return {
    finding,
    feature: {
      rules: featureRules,
      defaultValue: featureDefaultValue,
      scrubEnvRules: finding.legacyEnvRulesOnDisk,
    },
    liveRevision,
    createLiveRevision: finding.missingLiveRevision
      ? { version: migrated.version }
      : null,
    discardRevisions: finding.phantomPublishedVersions,
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
  { featureIds, repairedBy }: { featureIds?: string[]; repairedBy: string },
): Promise<FeatureRepairApplyResult[]> {
  const organization = context.org.id;
  const { analyzed } = await analyzeOrgFeatures(context, { featureIds });
  const revisionColl = getCollection<RawRevisionDoc>(REVISIONS_COLLECTION);
  const results: FeatureRepairApplyResult[] = [];

  for (const a of analyzed) {
    const { finding, migrated, liveRevisionRaw, liveRevisionMigrated } = a;
    const actions: string[] = [];
    try {
      const now = new Date();

      // 1. Missing live revision: insert one at the feature's current
      //    version so the publish/drift machinery has a baseline.
      //    (`createInitialRevision` hardcodes version 1, so insert directly.)
      if (finding.missingLiveRevision) {
        await revisionColl.insertOne({
          organization,
          featureId: migrated.id,
          version: migrated.version,
          dateCreated: now,
          dateUpdated: now,
          datePublished: now,
          createdBy: { type: "dashboard", id: "", email: repairedBy, name: "" },
          baseVersion: migrated.version - 1,
          status: "published",
          publishedBy: {
            type: "dashboard",
            id: "",
            email: repairedBy,
            name: "",
          },
          comment: "Backfilled by admin feature repair",
          defaultValue: migrated.defaultValue,
          rules: migrated.rules ?? [],
          environmentsEnabled: Object.fromEntries(
            Object.entries(migrated.environmentSettings ?? {}).map(
              ([env, s]) => [env, !!s.enabled],
            ),
          ),
          prerequisites: migrated.prerequisites ?? [],
          archived: migrated.archived ?? false,
        } as unknown as RawRevisionDoc);
        actions.push(`created live revision v${migrated.version}`);
      }

      // 2. Sparse live revision: sync it from the feature so a later
      //    GET-path drift repair can't rewrite the feature from a bad
      //    baseline. Never changes what's being served.
      if (
        finding.drift?.direction === "revision_from_feature" &&
        liveRevisionRaw
      ) {
        await revisionColl.updateOne(
          { organization, featureId: migrated.id, version: migrated.version },
          {
            $set: {
              rules: migrated.rules ?? [],
              defaultValue: migrated.defaultValue,
              dateUpdated: now,
            },
          },
        );
        actions.push(`synced live revision v${migrated.version} from feature`);
      }

      // 3. Feature doc write. Either a drift repair from the live revision
      //    (the exact same self-heal the GET/publish paths run) or a
      //    canonical-shape persist; both routes scrub legacy env rules from
      //    disk via `updateFeature`.
      const needsCanonicalWrite =
        finding.legacyEnvRulesOnDisk.length > 0 || finding.nonV2TopLevelRules;
      if (
        finding.drift?.direction === "feature_from_revision" &&
        liveRevisionMigrated
      ) {
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
      } else if (needsCanonicalWrite) {
        const original = { ...migrated };
        const repaired = await updateFeature(context, migrated, {
          rules: migrated.rules ?? [],
        });
        actions.push("persisted canonical v2 shape");
        try {
          await context.auditLog({
            event: "feature.update",
            entity: { object: "feature", id: migrated.id },
            details: auditDetailsUpdate(original, repaired, {
              autoRepair: true,
              adminRepair: true,
              repairedBy,
              note: "Admin feature repair: feature document persisted in canonical v2 shape",
              scrubbedEnvRules: finding.legacyEnvRulesOnDisk,
            }),
          });
        } catch (auditError) {
          logger.error(
            { err: auditError, featureId: migrated.id, orgId: organization },
            "Failed to write audit entry for admin feature repair",
          );
        }
      }

      // 4. Phantom-published revisions: never applied to the feature, so
      //    their published status is a lie. Mark discarded with a note.
      //    (`discardRevision` refuses published docs, hence the direct write.)
      for (const version of finding.phantomPublishedVersions) {
        const doc = await revisionColl.findOne(
          { organization, featureId: migrated.id, version },
          { projection: { comment: 1 } },
        );
        const existingComment =
          typeof doc?.comment === "string" && doc.comment.trim().length > 0
            ? `${doc.comment}\n`
            : "";
        await revisionColl.updateOne(
          { organization, featureId: migrated.id, version },
          {
            $set: {
              status: "discarded",
              dateUpdated: now,
              comment: `${existingComment}[admin repair] This revision was marked published but its changes were never applied to the feature; discarded to reflect the actual state.`,
            },
          },
        );
        actions.push(`discarded phantom-published revision v${version}`);
      }

      if (finding.corruptDrafts.length > 0) {
        actions.push(
          `flagged draft(s) for manual review: ${finding.corruptDrafts
            .map((d) => `v${d.version}`)
            .join(", ")}`,
        );
      }

      results.push({
        featureId: migrated.id,
        status: actions.length > 0 ? "repaired" : "skipped",
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
