import {
  ContextualBanditLinkageDelta,
  ContextualBanditLinkageState,
  computeContextualBanditLinkageDelta,
  getContextualBanditIdsFromRules,
} from "shared/util";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";
import { logger } from "back-end/src/util/logger";
import { promiseAllChunks } from "back-end/src/util/promise";

/** Cheap guard so writes that have nothing to do with bandits skip planning entirely. */
export function referencesAnyContextualBandit(rules: unknown): boolean {
  return getContextualBanditIdsFromRules(rules).length > 0;
}

/**
 * What a feature's rules imply for the bandits it touches, plus the linkage as
 * it stood when the plan was made so a failed publish can rewind to it.
 *
 * Deciding is separated from writing on purpose: the decision itself lives in
 * `computeContextualBanditLinkageDelta`, which is pure and unit-tested, and this
 * layer only fetches what it needs and writes what it is told.
 */
export type ContextualBanditLinkagePlan = {
  featureId: string;
  deltas: ContextualBanditLinkageDelta[];
  preImage: Record<string, ContextualBanditLinkageState>;
};

/**
 * Works out how `linkedFeatures` and `pendingFeatureDrafts` should change for
 * every bandit this feature touches. Returns null when nothing needs writing,
 * which is the common case.
 *
 * Bandits are seeded from the feature's rules *and* from those still holding
 * entries for it, so linkage left behind by a bandit no revision mentions any
 * more is swept in the same pass.
 */
export async function planFeatureContextualBanditLinkage(
  context: ReqContext | ApiReqContext,
  featureId: string,
  openDrafts: Pick<FeatureRevisionInterface, "version" | "rules">[],
  liveRules: unknown,
): Promise<ContextualBanditLinkagePlan | null> {
  const cbModel = context.models.contextualBandits;

  const referencedIds = new Set([
    ...getContextualBanditIdsFromRules(liveRules),
    ...openDrafts.flatMap((d) => getContextualBanditIdsFromRules(d.rules)),
  ]);

  const currentStateByBandit: Record<string, ContextualBanditLinkageState> = {};
  const record = (cb: {
    id: string;
    linkedFeatures?: string[];
    pendingFeatureDrafts?: { featureId: string; revisionVersion: number }[];
  }) => {
    currentStateByBandit[cb.id] = {
      linkedFeatures: cb.linkedFeatures ?? [],
      pendingFeatureDrafts: cb.pendingFeatureDrafts ?? [],
    };
  };

  // One query covers both sources: bandits still holding an entry for this
  // feature (however stale) and bandits its rules newly reference. A referenced
  // id absent from the result no longer exists, and is left out of the delta —
  // there is nothing to write for it.
  for (const cb of await cbModel.getLinkageCandidates(
    featureId,
    Array.from(referencedIds),
  )) {
    record(cb);
  }

  const deltas = computeContextualBanditLinkageDelta({
    featureId,
    liveRules,
    openDrafts,
    currentStateByBandit,
  });
  if (!deltas.length) return null;

  const preImage: Record<string, ContextualBanditLinkageState> = {};
  for (const delta of deltas) {
    preImage[delta.contextualBanditId] =
      currentStateByBandit[delta.contextualBanditId];
  }

  return { featureId, deltas, preImage };
}

export async function applyFeatureContextualBanditLinkage(
  context: ReqContext | ApiReqContext,
  plan: ContextualBanditLinkagePlan,
  // Refuse when this feature's slice has moved since the plan was computed. A landing
  // that lost the feature document to a newer publish would otherwise stamp its stale
  // delta over the winner's linkage — the same ownership question the rewind asks,
  // asked on the way in.
  { guarded }: { guarded?: boolean } = {},
): Promise<void> {
  const cbModel = context.models.contextualBandits;
  // Each bandit is independent, so bounded concurrency is safe — a feature can
  // reference thousands of distinct contextual bandits.
  //
  // Every write SETTLES before a failure is surfaced. `Promise.all` rejects on the
  // first failure while its siblings keep running, so compensation could inspect a
  // bandit before its forward write had landed, no-op, and then have that write
  // arrive after the rollback — leaving linkage from a failed publish live with
  // nothing left to undo it.
  const results = await promiseAllChunks(
    plan.deltas.map(
      (delta) => () =>
        cbModel
          .applyLinkageDelta(
            plan.featureId,
            delta,
            guarded ? plan.preImage[delta.contextualBanditId] : undefined,
          )
          .then(
            () => null,
            (e: unknown) => e,
          ),
    ),
    10,
  );
  const failure = results.find((e) => e !== null);
  if (failure) throw failure;
}

/**
 * Converges to the pre-image rather than inverting each write, so a forward pass
 * that failed partway still lands on the pre-publish state.
 */
export async function reverseFeatureContextualBanditLinkage(
  context: ReqContext | ApiReqContext,
  plan: ContextualBanditLinkagePlan,
): Promise<void> {
  const cbModel = context.models.contextualBandits;
  // Settle every rewind before surfacing a failure, for the same reason the
  // forward pass does — and here it matters more. `promiseAllChunks` runs
  // `Promise.all` per chunk, which rejects on the first failure: siblings in that
  // chunk kept running and later chunks never started, so a rewind could throw,
  // have compensation declare failure and KEEP the published feature, and then
  // land its remaining reversals afterwards — half the bandits rewound to a
  // pre-image whose feature is still live.
  const results = await promiseAllChunks(
    plan.deltas.map(
      (delta) => () =>
        cbModel
          .setLinkageState(
            delta.contextualBanditId,
            plan.featureId,
            plan.preImage[delta.contextualBanditId],
            // What the forward pass left this feature's slice holding. A second
            // writer who has since moved it owns it now, and converging to our
            // pre-image would undo their change.
            appliedLinkageState(plan, delta),
          )
          .then(
            () => null,
            (e: unknown) => e,
          ),
    ),
    10,
  );
  const failure = results.find((e) => e !== null);
  if (failure) throw failure;
}

/**
 * The state the forward pass wrote for one bandit: the pre-image with this
 * delta applied. Derived rather than recorded, so it can't drift from
 * `applyLinkageDelta`.
 */
function appliedLinkageState(
  plan: ContextualBanditLinkagePlan,
  delta: ContextualBanditLinkageDelta,
): ContextualBanditLinkageState {
  const pre = plan.preImage[delta.contextualBanditId];
  const linked = new Set(pre.linkedFeatures);
  if (delta.link) linked.add(plan.featureId);
  if (delta.unlink) linked.delete(plan.featureId);

  const dropped = new Set(delta.draftsToDrop);
  const drafts = pre.pendingFeatureDrafts.filter(
    (d) => d.featureId !== plan.featureId || !dropped.has(d.revisionVersion),
  );
  for (const version of delta.draftsToQueue) {
    if (
      !drafts.some(
        (d) => d.featureId === plan.featureId && d.revisionVersion === version,
      )
    ) {
      drafts.push({ featureId: plan.featureId, revisionVersion: version });
    }
  }

  return { linkedFeatures: [...linked], pendingFeatureDrafts: drafts };
}

/**
 * Plan and apply in one go, for writes that only move drafts around and so have
 * no publish to gate. Best-effort: logs and swallows, since the caller's write
 * has already happened and the next revision write re-derives the same answer.
 */
export async function syncFeatureContextualBanditLinkages(
  context: ReqContext | ApiReqContext,
  featureId: string,
  openDrafts: Pick<FeatureRevisionInterface, "version" | "rules">[],
  liveRevision: Pick<FeatureRevisionInterface, "rules"> | null,
): Promise<void> {
  try {
    const plan = await planFeatureContextualBanditLinkage(
      context,
      featureId,
      openDrafts,
      liveRevision?.rules,
    );
    if (!plan) return;
    await applyFeatureContextualBanditLinkage(context, plan);
  } catch (e) {
    logger.error(e, "syncFeatureContextualBanditLinkages failed");
  }
}
