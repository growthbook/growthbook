import { isEqual } from "lodash";

/**
 * The per-key compensation rule shared by both bulk adapters: build the
 * pre-image restore for a failed publish, writing back a key ONLY while the
 * live doc still holds the value this apply wrote (`written`). A later writer's
 * different value is newer intent and must not be clobbered.
 *
 * Value-based, so it cannot catch a concurrent writer that set a key to the
 * SAME value our apply wrote — that residual overwrite is the entity-write
 * lost-update window, closed only by CAS-guarding the apply itself.
 *
 * `skip(key)` lets a caller exclude keys it handles specially (e.g. the
 * feature adapter's holdout pointer). Pre-image `undefined` becomes `null`
 * (the clear signal) so the write layer's updatable-changes filter doesn't
 * drop fields the apply added.
 */
export function ownedRestoreValues(params: {
  keys: Iterable<string>;
  preImage: Record<string, unknown>;
  written: Record<string, unknown>;
  current: Record<string, unknown>;
  skip?: (key: string) => boolean;
}): Record<string, unknown> {
  const { keys, preImage, written, current, skip } = params;
  const restore: Record<string, unknown> = {};
  for (const key of keys) {
    if (skip?.(key)) continue;
    if (!isEqual(current[key], written[key])) continue;
    restore[key] = preImage[key] === undefined ? null : preImage[key];
  }
  return restore;
}
