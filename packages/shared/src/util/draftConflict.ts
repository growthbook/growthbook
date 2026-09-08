import isEqual from "lodash/isEqual";
import { DraftConflict } from "shared/types/draft-conflict";
import { threeWayMerge, ThreeWayMergeConfig } from "./threeWayMerge";

// One arrived as JSON, the other from Mongo.
function matchesBaseline<T extends object>(baseline: T, current: T): boolean {
  return isEqual(
    JSON.parse(JSON.stringify(baseline)),
    JSON.parse(JSON.stringify(current)),
  );
}

export type DraftEditResolution<T> =
  | { ok: true; merged: T; theirFields: string[] }
  | { ok: false; conflict: DraftConflict<T> };

// A missing baseline skips the guard, for callers that don't send one.
export function resolveDraftEdit<T extends object>({
  entityId,
  baseline,
  current,
  incoming,
  liveVersion,
  draftVersion,
  config,
}: {
  entityId: string;
  baseline: T | undefined;
  current: T | null;
  incoming: T;
  liveVersion: number;
  draftVersion?: number;
  config?: ThreeWayMergeConfig<T>;
}): DraftEditResolution<T> {
  if (!baseline || (current && matchesBaseline(baseline, current))) {
    return { ok: true, merged: incoming, theirFields: [] };
  }

  const merge = current
    ? threeWayMerge<T>(baseline, current, incoming, config)
    : null;
  if (merge?.merged && !merge.wholeEntity && merge.contested.length === 0) {
    return { ok: true, merged: merge.merged, theirFields: merge.theirFields };
  }

  return {
    ok: false,
    conflict: {
      entityId,
      current,
      liveVersion,
      ...(draftVersion !== undefined ? { draftVersion } : {}),
      ...(merge
        ? {
            merge: {
              contested: merge.contested,
              theirFields: merge.theirFields,
              yourFields: merge.yourFields,
              ...(merge.wholeEntity ? { wholeEntity: true } : {}),
            },
          }
        : {}),
    },
  };
}
