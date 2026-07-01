import { FeatureRevisionInterface } from "shared/types/feature-revision";
import { ContextualBanditRefRule } from "shared/validators";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";
import { logger } from "back-end/src/util/logger";

const OPEN_DRAFT_STATUSES = new Set([
  "draft",
  "pending-review",
  "approved",
  "changes-requested",
]);

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
  revisions: Pick<FeatureRevisionInterface, "version" | "status" | "rules">[],
): Promise<void> {
  try {
    const openDrafts = revisions.filter((r) =>
      OPEN_DRAFT_STATUSES.has(r.status),
    );
    const liveRevision = revisions
      .filter((r) => r.status === "published")
      .sort((a, b) => b.version - a.version)[0];

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

    await cbModel.clearStalePendingFeatureDrafts(
      featureId,
      Array.from(allCbIds),
    );
  } catch (e) {
    logger.error(e, "syncFeatureContextualBanditLinkages failed");
  }
}
