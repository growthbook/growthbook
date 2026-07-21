import { isEqual } from "lodash";

/**
 * Apply a compensation restore and confirm it fully landed. `write` persists
 * the fields and returns the keys it actually wrote (post updatable-filter and
 * normalization). A field that was dropped but isn't already at its restore
 * value (a no-op the filter skips) means the rollback is partial — throw so the
 * caller surfaces it and the item is reported published, not a clean rollback
 * missing a field the publish wrote.
 */
export async function applyVerifiedRestore(params: {
  restore: Record<string, unknown>;
  current: Record<string, unknown>;
  write: (restore: Record<string, unknown>) => Promise<string[]>;
  label: string;
}): Promise<void> {
  const { restore, current, write, label } = params;
  const keys = Object.keys(restore);
  if (!keys.length) return;
  const persisted = new Set(await write(restore));
  const dropped = keys.filter(
    (k) => !persisted.has(k) && !isEqual(restore[k], current[k]),
  );
  if (dropped.length) {
    throw new Error(
      `bulk publish compensation: ${label} restore dropped field(s) ${dropped.join(
        ", ",
      )} — left partially published`,
    );
  }
}
