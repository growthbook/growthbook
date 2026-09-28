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
  setPendingFeatureUnlink,
  unlinkLandedFeatureRemovals,
} from "back-end/src/models/ExperimentModel";
import { getLinkageSyncRevisionSummaries } from "back-end/src/models/FeatureRevisionModel";
import { logger } from "back-end/src/util/logger";
import { promiseAllChunks } from "back-end/src/util/promise";

type RevisionRules = Pick<FeatureRevisionInterface, "rules"> & {
  metadata?: Pick<
    NonNullable<FeatureRevisionInterface["metadata"]>,
    "valueType"
  >;
};

type LaunchCandidate = RevisionRules &
  Pick<FeatureRevisionInterface, "version"> & {
    // The revision it was cut from, when that isn't live.
    base?: RevisionRules;
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
 * rule for the experiment (or the flag's type) differs from live and from the
 * revision it was cut from. A draft that carries the rule unchanged, or an old
 * copy of it, is someone else's work and never launches with it.
 */
export function getLaunchDraftVersion(
  experimentId: string,
  openDrafts: LaunchCandidate[],
  liveRevision: RevisionRules | null,
): number | null {
  const changesFrom = (draft: RevisionRules, from: RevisionRules | null) => {
    const draftRules = experimentRefRules(draft.rules, experimentId);
    const draftType = draft.metadata?.valueType;
    const fromType = from?.metadata?.valueType;
    return (
      (draftRules.length > 0 &&
        !isEqual(draftRules, experimentRefRules(from?.rules, experimentId))) ||
      (!!draftType &&
        !!fromType &&
        draftType !== fromType &&
        getExperimentIdsFromRules(draft.rules).includes(experimentId))
    );
  };
  let launch: number | null = null;
  for (const draft of openDrafts) {
    const changesExperiment =
      changesFrom(draft, liveRevision) &&
      (!draft.base || changesFrom(draft, draft.base));
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
  liveRevision: RevisionRules | null,
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
    // Read again before linking: a removal may have landed since this sync's
    // own read, and linking it back would undo it.
    let stillReferenced: Promise<Set<string>> | null = null;
    const referencedNow = () =>
      (stillReferenced ??= getLinkageSyncRevisionSummaries(
        context.org.id,
        featureId,
      ).then(
        ({ openDrafts: drafts, liveRevision: live }) =>
          new Set([
            ...getExperimentIdsFromRules(live?.rules),
            ...drafts.flatMap((d) => getExperimentIdsFromRules(d.rules)),
          ]),
      ));

    await promiseAllChunks(
      Array.from(allExpIds).map((experimentId) => async () => {
        const experiment = await getExperimentById(context, experimentId);
        if (!experiment) return;

        if (!experiment.linkedFeatures?.includes(featureId)) {
          if (!(await referencedNow()).has(experimentId)) return;
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

        // A removal nobody's pursuing any more: live has the rule and no open
        // draft takes it out of the revision it was cut from.
        if (
          experiment.pendingFeatureUnlinks?.includes(featureId) &&
          liveExpIds.has(experimentId) &&
          !openDrafts.some(
            (d) =>
              !getExperimentIdsFromRules(d.rules).includes(experimentId) &&
              (!d.base ||
                getExperimentIdsFromRules(d.base.rules).includes(experimentId)),
          )
        ) {
          await setPendingFeatureUnlink(
            context,
            experimentId,
            featureId,
            false,
          );
        }
      }),
      10,
    );
    await settlePendingFeatureUnlinks(
      context,
      featureId,
      openDrafts,
      liveRevision?.rules,
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

/**
 * Unlinks the experiments waiting to drop this flag, once nothing live or open
 * still has their rule. Runs after draft writes and after a publish takes a
 * rule out; never throws.
 */
export async function settlePendingFeatureUnlinks(
  context: ReqContext | ApiReqContext,
  featureId: string,
  openDrafts: Pick<LaunchCandidate, "rules">[],
  liveRules: unknown,
): Promise<void> {
  try {
    await unlinkLandedFeatureRemovals(context, featureId, [
      ...new Set([
        ...getExperimentIdsFromRules(liveRules),
        ...openDrafts.flatMap((d) => getExperimentIdsFromRules(d.rules)),
      ]),
    ]);
  } catch (e) {
    logger.error(e, "settlePendingFeatureUnlinks failed");
  }
}

/** After a publish commits: the rules now live, and the drafts still open. */
export async function settleFeatureRemovalsAfterPublish(
  context: ReqContext | ApiReqContext,
  feature: { organization: string; id: string; rules?: unknown },
): Promise<void> {
  try {
    const { openDrafts } = await getLinkageSyncRevisionSummaries(
      feature.organization,
      feature.id,
    );
    await settlePendingFeatureUnlinks(
      context,
      feature.id,
      openDrafts,
      feature.rules,
    );
  } catch (e) {
    logger.error(e, "settleFeatureRemovalsAfterPublish failed");
  }
}
