import isEqual from "lodash/isEqual";
import { getExperimentIdsFromRules, naiveFlattenV1Rules } from "shared/util";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
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
import { promiseAllChunks } from "back-end/src/util/promise";

type LaunchCandidate = Pick<FeatureRevisionInterface, "version" | "rules"> & {
  metadata?: Pick<
    NonNullable<FeatureRevisionInterface["metadata"]>,
    "valueType"
  >;
};

// Plain JSON, so stored documents compare by value.
function experimentRefRules(
  rules: unknown,
  experimentId: string,
): ReturnType<typeof naiveFlattenV1Rules> {
  return JSON.parse(
    JSON.stringify(
      naiveFlattenV1Rules(rules).filter(
        (r) => r.type === "experiment-ref" && r.experimentId === experimentId,
      ),
    ),
  );
}

/**
 * The one draft an experiment launches for a flag: the newest open draft whose
 * rule for the experiment (or the flag's type) differs from live. A draft that
 * carries the rule unchanged is someone else's work and never launches with it.
 */
export function getLaunchDraftVersion(
  experimentId: string,
  openDrafts: LaunchCandidate[],
  liveRevision: Omit<LaunchCandidate, "version"> | null,
): number | null {
  const liveRules = experimentRefRules(liveRevision?.rules, experimentId);
  const liveType = liveRevision?.metadata?.valueType;
  let launch: number | null = null;
  for (const draft of openDrafts) {
    const draftRules = experimentRefRules(draft.rules, experimentId);
    const draftType = draft.metadata?.valueType;
    const changesExperiment =
      (draftRules.length > 0 && !isEqual(draftRules, liveRules)) ||
      (!!draftType &&
        !!liveType &&
        draftType !== liveType &&
        getExperimentIdsFromRules(draft.rules).includes(experimentId));
    if (changesExperiment && (launch === null || draft.version > launch)) {
      launch = draft.version;
    }
  }
  return launch;
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
  openDrafts: LaunchCandidate[],
  liveRevision: Omit<LaunchCandidate, "version"> | null,
): Promise<void> {
  try {
    // Every experiment an open draft references stays linked, but each
    // queues at most one draft of this feature to launch.
    const draftVersionsByExp = new Map<string, Set<number>>();
    for (const rev of openDrafts) {
      for (const expId of getExperimentIdsFromRules(rev.rules)) {
        if (draftVersionsByExp.has(expId)) continue;
        const launch = getLaunchDraftVersion(expId, openDrafts, liveRevision);
        draftVersionsByExp.set(expId, new Set(launch === null ? [] : [launch]));
      }
    }

    const liveExpIds = new Set(getExperimentIdsFromRules(liveRevision?.rules));
    const allExpIds = new Set([...liveExpIds, ...draftVersionsByExp.keys()]);

    // Each experimentId is independent (no shared mutable state across
    // iterations), so bounded concurrency is safe — a feature can
    // reference thousands of distinct experiments.
    await promiseAllChunks(
      Array.from(allExpIds).map((experimentId) => async () => {
        const experiment = await getExperimentById(context, experimentId);
        if (!experiment) return;

        if (!experiment.linkedFeatures?.includes(featureId)) {
          await addLinkedFeatureToExperiment(
            context,
            experimentId,
            featureId,
            experiment,
          );
        }

        const desired =
          draftVersionsByExp.get(experimentId) ?? new Set<number>();
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
      }),
      10,
    );

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
