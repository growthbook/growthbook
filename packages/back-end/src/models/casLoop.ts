/**
 * The compare-and-swap skeleton, once.
 *
 * Two implementations grew independently — `BaseModel.updateWithCas` and the feature
 * revision loop, which is forked because feature revisions are addressed by
 * `{organization, featureId, version}` rather than a single id. The loop bodies were
 * spelled identically down to the absence guard, and had already begun to drift: the
 * copy's docstring pointed at a `RevisionModel.casUpdate` that no longer exists.
 *
 * What differs between the two callers is pushed out to injected `read` and `write`,
 * so the parts that must not diverge — read every attempt, guard on what that read
 * observed, retry on a lost race — have one home.
 */

/**
 * Distinguishes the three ways a loop can end without applying.
 *
 * NO caller currently tells `aborted` and `not-found` apart — `BaseModel` returns
 * `null` for both and the feature revision caller reports both as `"aborted"`. The
 * loop keeps them separate anyway so a caller that wants "no such document" doesn't
 * have to re-read to find out, and so the two are testable here rather than only
 * through a boundary that has already merged them.
 */
export type CasOutcome<TResult> =
  | { status: "applied"; result: TResult }
  | { status: "aborted" }
  | { status: "not-found" }
  | { status: "exhausted" };

/**
 * The filter clause that pins `guardFields` to the values a read observed.
 *
 * An ABSENT field guards on its absence rather than on `undefined`. The two spellings
 * are not equivalent and they fail differently per driver: the raw driver runs with
 * `ignoreUndefined`, which strips the clause and leaves the write unconditional, so a
 * legacy self-heal would clobber whichever writer seeded the field first.
 *
 * Built from what the read OBSERVED, not from a migrated snapshot — a read-time
 * migration can change a value, and the guard has to describe the stored document.
 */
export function buildCasGuard(
  guardFields: readonly string[],
  observed: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    guardFields.map((f) => {
      const value = observed[f];
      return [f, value === undefined ? { $exists: false } : value];
    }),
  );
}

/** What one attempt's read yields: the value `compute` sees, and what to guard on. */
export type CasRead<TSnapshot> = {
  snapshot: TSnapshot;
  /** The stored document as read, for the guard. Often the same object as `snapshot`. */
  observed: Record<string, unknown>;
};

export async function runCasLoop<TSnapshot, TUpdate, TResult>({
  guardFields,
  maxAttempts = 5,
  read,
  compute,
  write,
}: {
  guardFields: readonly string[];
  maxAttempts?: number;
  /**
   * Re-read on EVERY attempt. Hoisting this out of the loop makes a retry re-guard on
   * the snapshot that already lost, so it can never converge — and nothing observable
   * says so, the write just stops happening.
   *
   * `null` ends the loop as `not-found`. A caller that also refuses the read for its
   * own reasons (an unreadable document) returns `null` too, when its boundary
   * collapses the two anyway.
   */
  read: () => Promise<CasRead<TSnapshot> | null>;
  /** `null` aborts: the caller has decided this write should not happen at all. */
  compute: (snapshot: TSnapshot) => TUpdate | null | Promise<TUpdate | null>;
  /** Applies `update` conditioned on `guard`. `applied: false` is a lost race. */
  write: (
    update: TUpdate,
    guard: Record<string, unknown>,
    snapshot: TSnapshot,
  ) => Promise<{ applied: true; result: TResult } | { applied: false }>;
}): Promise<CasOutcome<TResult>> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const current = await read();
    if (!current) return { status: "not-found" };

    const update = await compute(current.snapshot);
    if (!update) return { status: "aborted" };

    const written = await write(
      update,
      buildCasGuard(guardFields, current.observed),
      current.snapshot,
    );
    if (written.applied) return { status: "applied", result: written.result };
  }
  return { status: "exhausted" };
}
