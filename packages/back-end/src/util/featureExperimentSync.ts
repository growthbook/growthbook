import { FeatureRevisionInterface } from "shared/types/feature-revision";
import { ExperimentRefRule } from "shared/validators";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";
import {
  ExperimentModel,
  addLinkedFeatureToExperiment,
  addPendingFeatureDraftToExperiment,
  getExperimentById,
} from "back-end/src/models/ExperimentModel";
import { logger } from "back-end/src/util/logger";

const OPEN_DRAFT_STATUSES = new Set([
  "draft",
  "pending-review",
  "approved",
  "changes-requested",
]);

function getExperimentIdsFromRules(
  rules: FeatureRevisionInterface["rules"] | unknown,
): string[] {
  // Accept both v2 (FeatureRule[]) and legacy v1 (Record<envId, FeatureRule[]>)
  // shapes. getNonDiscardedRevisionSummaries reads raw docs, so v1 records
  // reach here untouched until the v2 migration finishes.
  const flat: unknown[] = Array.isArray(rules)
    ? rules
    : rules && typeof rules === "object"
      ? Object.values(rules as Record<string, unknown[]>).flat()
      : [];
  return flat
    .filter(
      (r): r is ExperimentRefRule =>
        !!r &&
        typeof r === "object" &&
        (r as { type?: string }).type === "experiment-ref",
    )
    .map((r) => r.experimentId)
    .filter((id): id is string => !!id);
}

/**
 * Reconciles experiment.linkedFeatures and experiment.pendingFeatureDrafts
 * after any feature revision write. Fire-and-forget: logs errors, never
 * throws. Only writes to experiments, so the circular import chain
 * (FeatureRevisionModel ↔ FeatureModel ↔ ExperimentModel ↔ here) resolves
 * lazily at runtime without a feedback loop.
 */
export async function syncFeatureExperimentLinkages(
  context: ReqContext | ApiReqContext,
  featureId: string,
  revisions: Pick<FeatureRevisionInterface, "version" | "status" | "rules">[],
): Promise<void> {
  try {
    // Newest draft first — first match per experimentId wins.
    const openDrafts = revisions
      .filter((r) => OPEN_DRAFT_STATUSES.has(r.status))
      .sort((a, b) => b.version - a.version);

    const liveRevision = revisions
      .filter((r) => r.status === "published")
      .sort((a, b) => b.version - a.version)[0];

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

    for (const experimentId of allExpIds) {
      const experiment = await getExperimentById(context, experimentId);
      if (!experiment) continue;

      if (!experiment.linkedFeatures?.includes(featureId)) {
        await addLinkedFeatureToExperiment(
          context,
          experimentId,
          featureId,
          experiment,
        );
      }

      const desiredVersion = draftVersionByExp.get(experimentId);
      const matchingEntries = (experiment.pendingFeatureDrafts ?? []).filter(
        (d) => d.featureId === featureId,
      );

      if (desiredVersion !== undefined) {
        // Rewrite on version drift or stale duplicates; the helper collapses
        // to a single entry.
        const upToDate =
          matchingEntries.length === 1 &&
          matchingEntries[0].revisionVersion === desiredVersion;
        if (!upToDate) {
          await addPendingFeatureDraftToExperiment(
            context,
            experimentId,
            featureId,
            desiredVersion,
          );
        }
      } else if (matchingEntries.length) {
        await ExperimentModel.updateOne(
          { id: experimentId, organization: context.org.id },
          { $pull: { pendingFeatureDrafts: { featureId } } },
        );
      }
    }

    // Strip pendingFeatureDrafts on experiments no longer referenced by any
    // live or draft rule. linkedFeatures is preserved — removal is user-driven.
    await ExperimentModel.updateMany(
      {
        organization: context.org.id,
        "pendingFeatureDrafts.featureId": featureId,
        id: { $nin: Array.from(allExpIds) },
      },
      { $pull: { pendingFeatureDrafts: { featureId } } },
    );
  } catch (e) {
    logger.error(e, "syncFeatureExperimentLinkages failed");
  }
}
