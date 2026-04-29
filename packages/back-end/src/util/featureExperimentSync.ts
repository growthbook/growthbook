import { FeatureRevisionInterface } from "shared/types/feature-revision";
import { ExperimentRefRule } from "shared/validators";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";
import {
  ExperimentModel,
  addLinkedFeatureToExperiment,
  addPendingFeatureDraftToExperiment,
} from "back-end/src/models/ExperimentModel";
import { logger } from "back-end/src/util/logger";

// Revision statuses that represent an open draft (not yet published/discarded).
const OPEN_DRAFT_STATUSES = new Set([
  "draft",
  "pending-review",
  "approved",
  "changes-requested",
]);

// Extracts experiment IDs referenced by experiment-ref rules in a rule list.
function getExperimentIdsFromRules(
  rules: FeatureRevisionInterface["rules"],
): string[] {
  return (rules ?? [])
    .filter((r) => r.type === "experiment-ref")
    .map((r) => (r as ExperimentRefRule).experimentId)
    .filter(Boolean);
}

/**
 * Reconciles experiment.linkedFeatures and experiment.pendingFeatureDrafts
 * for a given feature after any revision write (add rule, edit rule, publish,
 * discard). Designed to be called fire-and-forget; logs errors but never throws.
 *
 * Runtime safety: only writes to experiment documents via direct Mongoose calls.
 * None of those writes trigger hooks that write back to feature revisions, so
 * there is no runtime feedback loop.
 *
 * Compile-time circular imports: FeatureRevisionModel and FeatureModel import
 * this file; this file imports ExperimentModel; ExperimentModel imports
 * FeatureModel; FeatureModel imports FeatureRevisionModel. Node.js resolves this
 * correctly because all imported symbols are functions used lazily (never at
 * module initialisation time).
 */
export async function syncFeatureExperimentLinkages(
  context: ReqContext | ApiReqContext,
  featureId: string,
  revisions: Pick<FeatureRevisionInterface, "version" | "status" | "rules">[],
): Promise<void> {
  try {
    // Newest draft first — first match wins for pendingFeatureDrafts version.
    const openDrafts = revisions
      .filter((r) => OPEN_DRAFT_STATUSES.has(r.status))
      .sort((a, b) => b.version - a.version);

    // The highest-version published revision is always the live one.
    const liveRevision = revisions
      .filter((r) => r.status === "published")
      .sort((a, b) => b.version - a.version)[0];

    // experimentId → latest open-draft version that contains an experiment-ref rule.
    const draftVersionByExp = new Map<string, number>();
    for (const rev of openDrafts) {
      for (const expId of getExperimentIdsFromRules(rev.rules)) {
        if (!draftVersionByExp.has(expId)) {
          draftVersionByExp.set(expId, rev.version);
        }
      }
    }

    const liveExpIds = new Set(getExperimentIdsFromRules(liveRevision?.rules));
    const allExpIds = new Set([...liveExpIds, ...draftVersionByExp.keys()]);

    // Fix each experiment that has a live or draft rule for this feature.
    for (const experimentId of allExpIds) {
      // Fetch via raw model so we don't need to export findExperiment.
      const experiment = await ExperimentModel.findOne({
        id: experimentId,
        organization: context.org.id,
      });
      if (!experiment) continue;

      // Ensure the feature appears in linkedFeatures.
      if (!experiment.linkedFeatures?.includes(featureId)) {
        await addLinkedFeatureToExperiment(
          context,
          experimentId,
          featureId,
          experiment,
        );
      }

      const desiredVersion = draftVersionByExp.get(experimentId);
      const currentEntry = experiment.pendingFeatureDrafts?.find(
        (d) => d.featureId === featureId,
      );

      if (desiredVersion !== undefined) {
        // There is an open draft — ensure pendingFeatureDrafts is up to date.
        if (currentEntry?.revisionVersion !== desiredVersion) {
          await addPendingFeatureDraftToExperiment(
            context,
            experimentId,
            featureId,
            desiredVersion,
          );
        }
      } else if (currentEntry) {
        // Rule is live-only; no open draft remains — remove stale pending entry.
        await ExperimentModel.updateOne(
          { id: experimentId, organization: context.org.id },
          { $pull: { pendingFeatureDrafts: { featureId } } },
        );
      }
    }

    // Remove pendingFeatureDrafts entries on experiments that are no longer
    // referenced by any live or draft rule. We do NOT touch linkedFeatures
    // here — that removal is a user-driven action (the "Remove from experiment"
    // CTA on the discarded callout).
    await ExperimentModel.updateMany(
      {
        organization: context.org.id,
        "pendingFeatureDrafts.featureId": featureId,
        // Only target experiments not already handled above.
        id: { $nin: Array.from(allExpIds) },
      },
      { $pull: { pendingFeatureDrafts: { featureId } } },
    );
  } catch (e) {
    logger.error(e, "syncFeatureExperimentLinkages failed");
  }
}
