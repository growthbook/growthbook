import { isEqual } from "lodash";
import type { ExplorationConfig, JourneyDataset } from "shared/validators";
import { toFetchKey } from "@/enterprise/components/ProductAnalytics/util";

export function journeyDiffersOnlyByPath(
  submitted: ExplorationConfig,
  draft: ExplorationConfig,
): boolean {
  if (
    submitted.dataset.type !== "journey" ||
    draft.dataset.type !== "journey"
  ) {
    return false;
  }
  if (isEqual(submitted.dataset.path, draft.dataset.path)) return false;
  return isEqual(toFetchKey(submitted), toFetchKey(draft));
}

function journeyRemainingPrefetch(
  submitted: JourneyDataset,
  draft: JourneyDataset,
): number {
  const extra = Math.max(0, draft.path.length - submitted.path.length);
  return submitted.lookaheadDepth - extra;
}

export function journeyHistoryKey(config: ExplorationConfig): unknown {
  const key = toFetchKey(config) as { dataset: Record<string, unknown> };
  if (config.dataset.type !== "journey") return key;
  return {
    ...key,
    dataset: { ...key.dataset, optionsPerStep: null },
  };
}

export function journeyShouldPrefetchMore(
  rowSource: ExplorationConfig | null,
  draft: ExplorationConfig,
): boolean {
  if (!rowSource) return false;
  if (
    rowSource.dataset.type !== "journey" ||
    draft.dataset.type !== "journey"
  ) {
    return false;
  }
  if (!journeyDiffersOnlyByPath(rowSource, draft)) return false;
  if (draft.dataset.path.length <= rowSource.dataset.path.length) return false;
  return journeyRemainingPrefetch(rowSource.dataset, draft.dataset) <= 1;
}

/** Cache mode for a journey fetch. Null means the generic submit path. */
export function journeyFetchCache(
  rowSource: ExplorationConfig | null,
  draft: ExplorationConfig,
): "preferred" | null {
  if (draft.dataset.type !== "journey") return null;
  if (!rowSource || rowSource.dataset.type !== "journey") return "preferred";
  if (!journeyDiffersOnlyByPath(rowSource, draft)) return null;
  return "preferred";
}
