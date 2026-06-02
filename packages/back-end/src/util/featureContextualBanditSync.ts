import { FeatureRevisionInterface } from "shared/types/feature-revision";
import { ContextualBanditRefRule } from "shared/validators";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";
import { logger } from "back-end/src/util/logger";

/**
 * Open draft revision statuses — drafts in these states still apply to
 * `pendingFeatureDrafts` because a CB.start should publish them.
 * Mirrors `OPEN_DRAFT_STATUSES` in `featureExperimentSync.ts`.
 */
const OPEN_DRAFT_STATUSES = new Set([
  "draft",
  "pending-review",
  "approved",
  "changes-requested",
]);

function getContextualBanditIdsFromRules(
  rules: FeatureRevisionInterface["rules"] | unknown,
): string[] {
  // Accept v2 (FeatureRule[]) and legacy v1 (Record<envId, FeatureRule[]>):
  // raw-doc readers (e.g. getNonDiscardedRevisionSummaries) still hand us v1
  // shapes during the rolling migration.
  const flat: unknown[] = Array.isArray(rules)
    ? rules
    : rules && typeof rules === "object"
      ? Object.values(rules as Record<string, unknown[]>).flat()
      : [];
  return flat
    .filter(
      (r): r is ContextualBanditRefRule =>
        !!r &&
        typeof r === "object" &&
        (r as { type?: string }).type === "contextual-bandit-ref",
    )
    .map((r) => r.contextualBanditId)
    .filter((id): id is string => !!id);
}

/**
 * Reconciles `contextualBandit.linkedFeatures` and
 * `contextualBandit.pendingFeatureDrafts` after any feature revision write.
 *
 * Mirrors `syncFeatureExperimentLinkages` and runs alongside it: a single
 * revision can carry both `experiment-ref` and `contextual-bandit-ref`
 * rules, in which case both syncs fire (one per family). Each sync touches
 * only its own model so the circular import chain
 * (`FeatureRevisionModel` ↔ `FeatureModel` ↔ `ContextualBanditModel`)
 * resolves lazily at runtime.
 *
 * Fire-and-forget: logs errors, never throws.
 */
export async function syncFeatureContextualBanditLinkages(
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

    // (cbId -> set of open-draft revision versions referencing it).
    // Multiple drafts of this feature pointing at the same CB are kept
    // separately; they apply sequentially when the CB starts.
    const draftVersionsByCb = new Map<string, Set<number>>();
    for (const rev of openDrafts) {
      for (const cbId of getContextualBanditIdsFromRules(rev.rules)) {
        if (!draftVersionsByCb.has(cbId)) {
          draftVersionsByCb.set(cbId, new Set());
        }
        draftVersionsByCb.get(cbId)!.add(rev.version);
      }
    }

    const liveCbIds = new Set(
      getContextualBanditIdsFromRules(liveRevision?.rules),
    );
    const allCbIds = new Set([...liveCbIds, ...draftVersionsByCb.keys()]);

    const cbModel = context.models.contextualBandits;

    for (const cbId of allCbIds) {
      const cb = await cbModel.getById(cbId);
      if (!cb) continue;

      if (!cb.linkedFeatures?.includes(featureId)) {
        await cbModel.addLinkedFeature(cbId, featureId);
      }

      const desired = draftVersionsByCb.get(cbId) ?? new Set<number>();
      const current = new Set(
        (cb.pendingFeatureDrafts ?? [])
          .filter((d) => d.featureId === featureId)
          .map((d) => d.revisionVersion),
      );

      for (const version of desired) {
        if (!current.has(version)) {
          await cbModel.addPendingFeatureDraft(cbId, featureId, version);
        }
      }
      for (const version of current) {
        if (!desired.has(version)) {
          await cbModel.removePendingFeatureDraft(cbId, featureId, version);
        }
      }
    }

    // Strip pendingFeatureDrafts on CBs no longer referenced by any live or
    // draft rule. `linkedFeatures` is preserved — removal is user-driven,
    // matching the experiment side.
    await cbModel.clearStalePendingFeatureDrafts(
      featureId,
      Array.from(allCbIds),
    );
  } catch (e) {
    logger.error(e, "syncFeatureContextualBanditLinkages failed");
  }
}
