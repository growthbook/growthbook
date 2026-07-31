import { FeatureRevisionInterface } from "shared/types/feature-revision";
import { ContextualBanditRefRule } from "shared/validators";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";
import { logger } from "back-end/src/util/logger";
import { promiseAllChunks } from "back-end/src/util/promise";

/** Cheap guard so publishes that have nothing to do with bandits skip the sync's revision reads. */
export function referencesAnyContextualBandit(
  rules: FeatureRevisionInterface["rules"] | unknown,
): boolean {
  return getContextualBanditIdsFromRules(rules).length > 0;
}

function getContextualBanditIdsFromRules(
  rules: FeatureRevisionInterface["rules"] | unknown,
): string[] {
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
 * Fire-and-forget reconciliation of `linkedFeatures` / `pendingFeatureDrafts` on
 * CBs after a feature revision write. The two arrays answer different questions
 * and a feature can legitimately sit in both:
 *
 * - `linkedFeatures`: the feature's **live** revision serves a rule for this
 *   bandit, so the bandit is (or would be, once started) reaching users there.
 * - `pendingFeatureDrafts`: open drafts touching this bandit's rules, keyed by
 *   revision version. These are the drafts the bandit publishes on start.
 */
export async function syncFeatureContextualBanditLinkages(
  context: ReqContext | ApiReqContext,
  featureId: string,
  openDrafts: Pick<FeatureRevisionInterface, "version" | "rules">[],
  liveRevision: Pick<FeatureRevisionInterface, "rules"> | null,
): Promise<void> {
  try {
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

    // Each cbId is independent (no shared mutable state across
    // iterations), so bounded concurrency is safe — a feature can
    // reference thousands of distinct contextual bandits.
    await promiseAllChunks(
      Array.from(allCbIds).map((cbId) => async () => {
        const cb = await cbModel.getById(cbId);
        if (!cb) return;

        // A draft reference alone doesn't count as linked — the rule isn't
        // serving anyone until the draft publishes, and until then it's tracked
        // as a pending draft instead.
        if (liveCbIds.has(cbId)) {
          await cbModel.addLinkedFeature(cbId, featureId);
        } else {
          await cbModel.removeLinkedFeature(cbId, featureId);
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
      }),
      10,
    );

    // Bandits no longer referenced by any revision never made it into the loop
    // above, so drop the feature from them here.
    await cbModel.clearStalePendingFeatureDrafts(
      featureId,
      Array.from(allCbIds),
    );
    await cbModel.clearStaleLinkedFeatures(featureId, Array.from(liveCbIds));
  } catch (e) {
    logger.error(e, "syncFeatureContextualBanditLinkages failed");
  }
}
