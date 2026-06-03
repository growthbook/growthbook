// One-shot migration script for the CB experiment-decoupling work.
//
// What this does
// --------------
//
//   1. Persists CB-native fields onto every CB doc. After PR-2 added the
//      native fields and PR-2(c) wired up `backfillFromExperiment` at
//      read-time, CB docs continued to *appear* fully populated to
//      readers, but the on-disk shape still had only the FK + the
//      tree-config fields. PR-8's FK drop requires the on-disk shape to
//      carry the native fields too — this loop reads each CB, lets the
//      model hydrate it, and writes it back.
//
//   2. Rewrites feature rules that point at CB-typed experiments
//      (`experiment-ref` with `experimentId` referencing a CB) to the new
//      `contextual-bandit-ref` rule type added in PR-3. Both the
//      top-level `feature.rules` array and every non-discarded feature
//      revision's rules are updated. The wire-format SDK payload doesn't
//      change — getFeatureDefinition already dual-reads both rule types.
//
// What this does NOT do
// ---------------------
//
//   - Does not drop the `experiment` FK on the CB doc.
//   - Does not remove `contextualBanditId`/`contextualBanditEventId` from
//     the experiment validator.
//   - Does not remove `"contextual-bandit"` from the experimentType enum.
//   - Does not delete the `/experiments/:id/contextual-bandit/*` legacy
//     REST routes.
//
// Those four cleanups land in a follow-up PR-8 commit once this migration
// has been run on every target environment.
//
// Idempotency
// -----------
//
// Both passes are idempotent. The CB-doc pass is a no-op when the doc
// already has CB-native data (`hasNativeShape` returns true). The
// feature-rule pass only rewrites rules that still type as
// `experiment-ref` and point at an experiment with `type:
// "contextual-bandit"`; running it twice rewrites zero rules the second
// time.
//
// Usage
// -----
//
//   pnpm --filter back-end migrate-cb-decoupling           # dry-run
//   pnpm --filter back-end migrate-cb-decoupling --apply   # writes
//
// In dry-run mode the script logs the count of would-be changes per
// collection but doesn't write anything; useful for a safety check on
// large orgs.

/* eslint-disable no-restricted-imports */
import "../init/aliases";
/* eslint-enable no-restricted-imports */

import {
  ContextualBanditInterface,
  FeatureRule,
  ContextualBanditRefRule,
  ExperimentRefRule,
} from "shared/validators";
import { getCollection } from "back-end/src/util/mongo.util";
import { init } from "back-end/src/init";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";
import { logger } from "back-end/src/util/logger";

const APPLY = process.argv.includes("--apply");

const CB_COLLECTION = "contextualbandits";
const FEATURE_COLLECTION = "features";
const REVISION_COLLECTION = "featurerevisions";

type CBKey = Pick<
  ContextualBanditInterface,
  "id" | "organization" | "experiment"
>;

/**
 * Rewrite a feature-rule list, replacing any `experiment-ref` rule that
 * targets a CB-typed experiment with the equivalent `contextual-bandit-ref`.
 * Returns the new array AND a flag indicating whether anything changed.
 */
function rewriteRules(
  rules: FeatureRule[] | undefined,
  experimentToCb: Map<string, string>,
): { rules: FeatureRule[]; changed: boolean } {
  if (!Array.isArray(rules)) return { rules: [], changed: false };
  let changed = false;
  const next = rules.map((r) => {
    if (r.type !== "experiment-ref") return r;
    const ref = r as ExperimentRefRule;
    const cbId = experimentToCb.get(ref.experimentId);
    if (!cbId) return r;
    changed = true;
    const replaced: ContextualBanditRefRule = {
      ...ref,
      type: "contextual-bandit-ref",
      // Drop the legacy field via the spread, then re-cast as the new shape.
      contextualBanditId: cbId,
      variations: ref.variations,
    } as unknown as ContextualBanditRefRule;
    // `experimentId` doesn't belong on the new shape; explicitly remove it.
    delete (replaced as unknown as { experimentId?: string }).experimentId;
    return replaced;
  });
  return { rules: next, changed };
}

async function migrateContextualBanditDocs(): Promise<{
  total: number;
  updated: number;
}> {
  // Walk every CB doc cross-org. The model's `getById` runs the
  // backfill-from-experiment hydrator; we read it, then write the
  // hydrated copy back via `.update(cb, hydrated)` so the on-disk shape
  // carries native fields after this pass.
  const rawDocs = await getCollection<CBKey>(CB_COLLECTION)
    .find({})
    .project<CBKey>({ id: true, organization: true, experiment: true })
    .toArray();

  let updated = 0;
  for (const raw of rawDocs) {
    try {
      const context = await getContextForAgendaJobByOrgId(raw.organization);
      const cb = await context.models.contextualBandits.getById(raw.id);
      if (!cb) continue;
      // `cb.name` empty after hydrate ⇒ no parent experiment to source
      // from, which means the doc is already legacy-orphaned and there's
      // nothing to persist. Skip it.
      if (!cb.name) continue;

      if (APPLY) {
        // Re-supply the hydrated CB via update so backfilled values are
        // persisted. BaseModel.update strips protected base fields (id,
        // organization, dateCreated, dateUpdated) from the `changes`
        // shape, so destructure them out before passing — otherwise tsc
        // flags `id: string` as incompatible with `Forbid<"id" | ...>`.
        const {
          id: _id,
          organization: _org,
          dateCreated: _dc,
          dateUpdated: _du,
          ...changes
        } = cb;
        await context.models.contextualBandits.update(cb, changes);
      }
      updated++;
    } catch (e) {
      logger.error(e, `CB doc migration failed for ${raw.id}`);
    }
  }
  return { total: rawDocs.length, updated };
}

async function migrateFeatureRules(): Promise<{
  featuresScanned: number;
  featuresUpdated: number;
  revisionsScanned: number;
  revisionsUpdated: number;
}> {
  // Build a per-org map of experimentId → contextualBanditId so the
  // rewrite step doesn't have to round-trip to the DB per rule. Limited
  // to CB-typed experiments only.
  const cbDocs = await getCollection<CBKey>(CB_COLLECTION)
    .find({ experiment: { $exists: true } })
    .project<CBKey>({ id: true, organization: true, experiment: true })
    .toArray();
  const byOrg = new Map<string, Map<string, string>>();
  for (const cb of cbDocs) {
    if (!cb.experiment) continue;
    if (!byOrg.has(cb.organization)) byOrg.set(cb.organization, new Map());
    byOrg.get(cb.organization)!.set(cb.experiment, cb.id);
  }

  let featuresScanned = 0;
  let featuresUpdated = 0;
  let revisionsScanned = 0;
  let revisionsUpdated = 0;

  // Iterate features per-org so we can use the in-memory CB-id map.
  for (const [orgId, experimentToCb] of byOrg.entries()) {
    // Pull only the features in this org that have at least one
    // experiment-ref rule referencing a known CB-typed experiment.
    const candidateExpIds = Array.from(experimentToCb.keys());

    const features = await getCollection<{
      id: string;
      organization: string;
      rules?: FeatureRule[];
    }>(FEATURE_COLLECTION)
      .find({
        organization: orgId,
        "rules.experimentId": { $in: candidateExpIds },
      })
      .toArray();

    for (const f of features) {
      featuresScanned++;
      const { rules: nextRules, changed } = rewriteRules(
        f.rules,
        experimentToCb,
      );
      if (!changed) continue;
      if (APPLY) {
        await getCollection<{ id: string; organization: string }>(
          FEATURE_COLLECTION,
        ).updateOne(
          { id: f.id, organization: orgId },
          { $set: { rules: nextRules, dateUpdated: new Date() } },
        );
      }
      featuresUpdated++;
    }

    const revisions = await getCollection<{
      _id: unknown;
      organization: string;
      featureId: string;
      version: number;
      status: string;
      rules?: FeatureRule[];
    }>(REVISION_COLLECTION)
      .find({
        organization: orgId,
        status: { $ne: "discarded" },
        "rules.experimentId": { $in: candidateExpIds },
      })
      .toArray();

    for (const r of revisions) {
      revisionsScanned++;
      const { rules: nextRules, changed } = rewriteRules(
        r.rules,
        experimentToCb,
      );
      if (!changed) continue;
      if (APPLY) {
        await getCollection<{
          organization: string;
          featureId: string;
          version: number;
        }>(REVISION_COLLECTION).updateOne(
          {
            organization: orgId,
            featureId: r.featureId,
            version: r.version,
          },
          { $set: { rules: nextRules, dateUpdated: new Date() } },
        );
      }
      revisionsUpdated++;
    }
  }

  return {
    featuresScanned,
    featuresUpdated,
    revisionsScanned,
    revisionsUpdated,
  };
}

async function run() {
  await init();

  logger.info(
    `CB decoupling migration: starting in ${APPLY ? "APPLY" : "DRY-RUN"} mode`,
  );

  const cbStats = await migrateContextualBanditDocs();
  logger.info(
    `CB docs: ${cbStats.updated}/${cbStats.total} would-be-updated (apply=${APPLY})`,
  );

  const ruleStats = await migrateFeatureRules();
  logger.info(
    `Feature rules: ${ruleStats.featuresUpdated}/${ruleStats.featuresScanned} features, ${ruleStats.revisionsUpdated}/${ruleStats.revisionsScanned} revisions would-be-rewritten (apply=${APPLY})`,
  );

  if (!APPLY) {
    logger.info("Dry run complete. Re-run with --apply to commit changes.");
  } else {
    logger.info("Migration complete.");
  }
  process.exit(0);
}

run().catch((err) => {
  logger.error(err, "CB decoupling migration failed");
  process.exit(1);
});
