import cloneDeep from "lodash/cloneDeep";
import isEqual from "lodash/isEqual";
import omit from "lodash/omit";
import { LegacyFeatureInterface } from "shared/types/feature";
import {
  buildFeatureUpdate,
  computePrerequisiteIds,
  FeatureModel,
  migrateRawFeatureToV2,
} from "back-end/src/models/FeatureModel";
import {
  getAllOrganizationIds,
  updateOrganization,
} from "back-end/src/models/OrganizationModel";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";
import { hasNoV1EnvRules } from "back-end/src/util/flattenRules";
import { logger } from "back-end/src/util/logger";
import { getCollection } from "back-end/src/util/mongo.util";

const BACKUP_COLLECTION = "features_v2_backfill_backups";

export type OrgBackfillStats = {
  orgId: string;
  scanned: number;
  conforming: number;
  rewritten: number;
  // Doc whose persisted form would not read back identically — left as-is.
  skippedInvariant: number;
  // Doc changed concurrently (user save won — it wrote v2 + stamp anyway).
  skippedConflict: number;
  errors: number;
  markedOrg: boolean;
};

export type BackfillOptions = {
  dryRun?: boolean;
  orgIds?: string[];
  // Pause between docs to bound write throughput on large corpora.
  writeIntervalMs?: number;
};

type RawFeatureDoc = LegacyFeatureInterface & {
  _id: unknown;
  __v?: unknown;
};

// A doc conforms when an index-backed read needs no JIT rule migration and
// the denormalized prerequisiteIds stamp is present. Rule-less v2 docs lack
// the v2 rule markers but carry no legacy material, so they conform too.
export function rawFeatureConforms(raw: LegacyFeatureInterface): boolean {
  if (!Array.isArray(raw.prerequisiteIds)) return false;
  if (!raw.environmentSettings) return false;
  if (!hasNoV1EnvRules(raw.environmentSettings)) return false;
  const rules = Array.isArray(raw.rules) ? raw.rules : [];
  if (rules.length === 0) return true;
  return rules.some(
    (r) =>
      r &&
      typeof r === "object" &&
      ("allEnvironments" in r || "environments" in r),
  );
}

export async function backfillFeaturesV2ForOrg(
  orgId: string,
  { dryRun = false, writeIntervalMs = 0 }: BackfillOptions = {},
): Promise<OrgBackfillStats> {
  const stats: OrgBackfillStats = {
    orgId,
    scanned: 0,
    conforming: 0,
    rewritten: 0,
    skippedInvariant: 0,
    skippedConflict: 0,
    errors: 0,
    markedOrg: false,
  };

  const context = await getContextForAgendaJobByOrgId(orgId);

  const cursor = FeatureModel.find({ organization: orgId })
    .lean<RawFeatureDoc[]>()
    .cursor();

  for await (const doc of cursor) {
    stats.scanned++;
    const raw = omit(doc, ["_id", "__v"]) as LegacyFeatureInterface;

    try {
      if (rawFeatureConforms(raw)) {
        stats.conforming++;
        continue;
      }

      // `prerequisiteIds` is stripped on read (toInterface), so it must be
      // excluded from both sides of the invariant comparison.
      const rawForRead = omit(raw, ["prerequisiteIds"]);
      // v0 docs get `draft` folded into the in-memory `legacyDraft` on read;
      // we can't persist that (legacyDraft is derived, not stored), so v0
      // docs with a draft only pass the invariant check when the draft is
      // inactive or already migrated.
      const isV0 = !raw.environmentSettings;

      const migrated = migrateRawFeatureToV2(cloneDeep(raw), context);

      const setPayload = {
        ...buildFeatureUpdate({
          rules: migrated.rules,
          environmentSettings: migrated.environmentSettings,
        }),
        version: migrated.version,
        prerequisiteIds: computePrerequisiteIds(migrated),
      };
      const unsetKeys = [
        "environments",
        "revision",
        ...(isV0 ? ["draft"] : []),
      ];

      // Invariant: the rewritten doc must read back exactly like the
      // original does today. Anything else is skipped, never written.
      const simulatedRaw = {
        ...omit(rawForRead, unsetKeys),
        ...omit(setPayload, ["prerequisiteIds"]),
      } as LegacyFeatureInterface;
      const before = migrateRawFeatureToV2(
        cloneDeep(rawForRead) as LegacyFeatureInterface,
        context,
      );
      const after = migrateRawFeatureToV2(cloneDeep(simulatedRaw), context);
      if (!isEqual(before, after)) {
        stats.skippedInvariant++;
        logger.warn(
          { orgId, featureId: raw.id },
          "featuresV2Backfill: read-equivalence invariant failed, skipping doc",
        );
        continue;
      }

      if (dryRun) {
        stats.rewritten++;
        continue;
      }

      // Pre-image backup is the rollback path (v2 -> v1 is not reversible).
      await getCollection(BACKUP_COLLECTION).insertOne({
        originalId: doc._id,
        backfillDate: new Date(),
        doc: raw,
      });

      // Optimistic guard on dateUpdated: a concurrent user save (which
      // writes v2 + stamp itself) wins and this becomes a no-op.
      const res = await FeatureModel.updateOne(
        {
          _id: doc._id,
          dateUpdated: raw.dateUpdated ?? null,
        },
        {
          $set: setPayload,
          $unset: Object.fromEntries(unsetKeys.map((k) => [k, 1])),
        },
      );
      if (res.matchedCount === 0) {
        stats.skippedConflict++;
        continue;
      }
      stats.rewritten++;

      if (writeIntervalMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, writeIntervalMs));
      }
    } catch (e) {
      stats.errors++;
      logger.error(
        e,
        `featuresV2Backfill: error processing feature ${raw.id} in org ${orgId}`,
      );
    }
  }

  // Concurrency-safe to mark on clean stats alone: any doc written after the
  // scan (create/update) is v2 + stamped by the write chokepoints, and
  // conflict-skipped docs were rewritten by a user save.
  const complete = stats.skippedInvariant === 0 && stats.errors === 0;
  if (complete && !dryRun) {
    await updateOrganization(orgId, { migrations: { featuresV2: true } });
    stats.markedOrg = true;
  }

  return stats;
}

export async function backfillFeaturesV2(
  options: BackfillOptions = {},
): Promise<OrgBackfillStats[]> {
  const orgIds = options.orgIds?.length
    ? options.orgIds
    : await getAllOrganizationIds();

  const allStats: OrgBackfillStats[] = [];
  for (const orgId of orgIds) {
    try {
      const stats = await backfillFeaturesV2ForOrg(orgId, options);
      allStats.push(stats);
      if (stats.scanned > 0 || !stats.markedOrg) {
        logger.info(stats, "featuresV2Backfill: org processed");
      }
    } catch (e) {
      logger.error(e, `featuresV2Backfill: failed to process org ${orgId}`);
    }
  }
  return allStats;
}
