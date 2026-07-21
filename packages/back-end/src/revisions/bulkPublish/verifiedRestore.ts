import { isEqual } from "lodash";

/**
 * Apply a compensation restore and PROVE it landed. `write` persists the given
 * fields and returns the keys it actually wrote (post updatable-filter and
 * post-normalization). If any intended field was dropped — and isn't already at
 * its restore value (a no-op the write filter legitimately skips) — the
 * rollback is partial: throw so the caller records a reversal failure and the
 * item is reported still-published, never a clean rollback missing a field a
 * failed publish wrote.
 *
 * This is the single enforcement point behind the compensation invariant: a
 * restore step reports success ONLY when its write is provably complete. It
 * turns a "silently partial write" (a config field stripped by normalization
 * against changed ancestry, a filter-dropped key) into a surfaced failure, and
 * makes an upstream best-effort baseline capture safe — its degraded input can
 * no longer masquerade as a clean rollback.
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
