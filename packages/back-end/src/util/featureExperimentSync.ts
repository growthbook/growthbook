import { FeatureRevisionInterface } from "shared/types/feature-revision";
import { ExperimentRefRule } from "shared/validators";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";
import {
  ExperimentModel,
  addLinkedFeatureToExperiment,
  addPendingFeatureDraftToExperiment,
  getExperimentById,
  removePendingFeatureDraftFromExperiment,
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
  // Accept v2 (FeatureRule[]) and legacy v1 (Record<envId, FeatureRule[]>):
  // raw-doc readers (e.g. getNonDiscardedRevisionSummaries) hand us v1 shapes
  // until the migration completes.
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
 * throws. Writes only to experiments so the circular import chain
 * (FeatureRevisionModel ↔ FeatureModel ↔ ExperimentModel ↔ here) resolves
 * lazily at runtime without a feedback loop.
 */
export async function syncFeatureExperimentLinkages(
  context: ReqContext | ApiReqContext,
  featureId: string,
  revisions: Pick<FeatureRevisionInterface, "version" | "status" | "rules">[],
): Promise<void> {
  try {
    const openDrafts = revisions.filter((r) =>
      OPEN_DRAFT_STATUSES.has(r.status),
    );
    const liveRevision = revisions
      .filter((r) => r.status === "published")
      .sort((a, b) => b.version - a.version)[0];

    // (expId -> set of open-draft versions referencing it). Multiple drafts
    // of this feature referencing the same experiment all stay tracked — they
    // get applied sequentially on experiment start.
    const draftVersionsByExp = new Map<string, Set<number>>();
    for (const rev of openDrafts) {
      for (const expId of getExperimentIdsFromRules(rev.rules)) {
        if (!draftVersionsByExp.has(expId)) {
          draftVersionsByExp.set(expId, new Set());
        }
        draftVersionsByExp.get(expId)!.add(rev.version);
      }
    }

    const liveExpIds = new Set(getExperimentIdsFromRules(liveRevision?.rules));
    const allExpIds = new Set([...liveExpIds, ...draftVersionsByExp.keys()]);

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

      const desired = draftVersionsByExp.get(experimentId) ?? new Set<number>();
      const current = new Set(
        (experiment.pendingFeatureDrafts ?? [])
          .filter((d) => d.featureId === featureId)
          .map((d) => d.revisionVersion),
      );

      for (const version of desired) {
        if (!current.has(version)) {
          await addPendingFeatureDraftToExperiment(
            context,
            experimentId,
            featureId,
            version,
          );
        }
      }
      for (const version of current) {
        if (!desired.has(version)) {
          await removePendingFeatureDraftFromExperiment(
            context,
            experimentId,
            featureId,
            version,
          );
        }
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
