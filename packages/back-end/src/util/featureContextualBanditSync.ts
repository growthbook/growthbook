import { FeatureRevisionInterface } from "shared/types/feature-revision";
import { ContextualBanditRefRule } from "shared/validators";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";
import { logger } from "back-end/src/util/logger";
import { promiseAllChunks } from "back-end/src/util/promise";

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

/** Fire-and-forget reconciliation of `linkedFeatures` / `pendingFeatureDrafts` on CBs after a feature revision write. */
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
      }),
      10,
    );

    await cbModel.clearStalePendingFeatureDrafts(
      featureId,
      Array.from(allCbIds),
    );
  } catch (e) {
    logger.error(e, "syncFeatureContextualBanditLinkages failed");
  }
}
