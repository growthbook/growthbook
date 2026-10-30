import isEqual from "lodash/isEqual";
import { getExperimentIdsFromRules, naiveFlattenV1Rules } from "shared/util";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import { FeatureRule } from "shared/validators";
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

type RevisionRules = Pick<FeatureRevisionInterface, "rules">;

type LaunchCandidate = RevisionRules &
  Pick<FeatureRevisionInterface, "version"> & {
    // The revision it was cut from, when that isn't live.
    base?: RevisionRules;
  };

type RuleMatcher = (rule: FeatureRule) => boolean;

// Plain JSON, so stored documents compare by value.
function matchedRules(rules: unknown, matches: RuleMatcher): FeatureRule[] {
  return JSON.parse(JSON.stringify(naiveFlattenV1Rules(rules).filter(matches)));
}

// Newest first. A draft carrying the rules unchanged from live or from its own
// base, or an old copy of them, is someone else's work.
export function getRuleChangingDraftVersions(
  matches: RuleMatcher,
  openDrafts: LaunchCandidate[],
  liveRevision: RevisionRules | null,
): number[] {
  const changesFrom = (draft: RevisionRules, from: RevisionRules | null) => {
    const draftRules = matchedRules(draft.rules, matches);
    return (
      draftRules.length > 0 &&
      !isEqual(draftRules, matchedRules(from?.rules, matches))
    );
  };
  return openDrafts
    .filter(
      (draft) =>
        changesFrom(draft, liveRevision) &&
        (!draft.base || changesFrom(draft, draft.base)),
    )
    .map((draft) => draft.version)
    .sort((a, b) => b - a);
}

export function getLaunchDraftVersion(
  experimentId: string,
  openDrafts: LaunchCandidate[],
  liveRevision: RevisionRules | null,
): number | null {
  return (
    getRuleChangingDraftVersions(
      (r) => r.type === "experiment-ref" && r.experimentId === experimentId,
      openDrafts,
      liveRevision,
    )[0] ?? null
  );
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

    // Read again before linking: a removal may have landed since this sync's
    // own read, and linking it back would undo it.
    let stillReferenced: Promise<Set<string>> | null = null;
    const referencedNow = () =>
      (stillReferenced ??= getLinkageSyncRevisionSummaries(
        context.org.id,
        featureId,
      ).then(
        ({ openDrafts: drafts, liveRevision: live }) =>
          new Set(referencedExperimentIds(live?.rules, drafts)),
      ));

    // Each experimentId is independent (no shared mutable state across
    // iterations), so bounded concurrency is safe — a feature can
    // reference thousands of distinct experiments.
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
          !openDrafts.some((d) =>
            draftTakesRuleOut(
              (rules) =>
                getExperimentIdsFromRules(rules).includes(experimentId),
              d,
              d.base,
            ),
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

// Unlinks the experiments waiting to drop this flag once nothing live or open
// still has their rule. Never throws.
async function settlePendingFeatureUnlinks(
  context: ReqContext | ApiReqContext,
  featureId: string,
  openDrafts: Pick<LaunchCandidate, "rules">[],
  liveRules: unknown,
): Promise<void> {
  try {
    await unlinkLandedFeatureRemovals(
      context,
      featureId,
      referencedExperimentIds(liveRules, openDrafts),
    );
  } catch (e) {
    logger.error(e, "settlePendingFeatureUnlinks failed");
  }
}

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

function referencedExperimentIds(
  liveRules: unknown,
  openDrafts: Pick<LaunchCandidate, "rules">[],
): string[] {
  return [
    ...new Set([
      ...getExperimentIdsFromRules(liveRules),
      ...openDrafts.flatMap((d) => getExperimentIdsFromRules(d.rules)),
    ]),
  ];
}

// A base that can't be found counts as having the rule.
export function draftTakesRuleOut<R>(
  hasRule: (rules: R | undefined) => boolean,
  draft: { rules?: R },
  base: { rules?: R } | null | undefined,
): boolean {
  return !hasRule(draft.rules) && (!base || hasRule(base.rules));
}
