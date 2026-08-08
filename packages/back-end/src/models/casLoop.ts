/**
 * The compare-and-swap skeleton, once.
 *
 * `BaseModel.updateWithCas` and the feature revision loop are separate callers —
 * feature revisions are addressed by `{organization, featureId, version}` rather
 * than a single id — so what differs is injected as `read` and `write`. The parts
 * that must not diverge (read every attempt, guard on what that read observed,
 * retry on a lost race) have one home.
 */

/**
 * The three ways a loop can end without applying. No caller currently tells
 * `aborted` from `not-found`, but the loop keeps them separate so one that wants
 * "no such document" need not re-read to find out.
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
      return [
        f,
        // CLONED, not referenced. The guard has to describe the document AS READ,
        // and a by-reference capture doesn't: a model's `beforeUpdate` hook runs
        // inside the write, on a `newDoc` that shares this very object (the read
        // path copies only the top level), so it can rewrite the guard between the
        // moment it is built and the moment it reaches the filter.
        //
        // That happened: `RevisionModel.beforeUpdate` rebuilds
        // `target.snapshot` through the adapter's `buildSnapshot`, which emits keys
        // in its own allowed-keys order. Mongo compares embedded documents by
        // FIELD ORDER, so a snapshot whose stored order differed produced a filter
        // that could never match — every retry re-read, re-mutated identically, and
        // the loop exhausted with a 500 on an otherwise ordinary revision.
        //
        // `structuredClone` preserves Dates (activityLog, reviews). It would throw
        // on a BSON exotic like ObjectId; nothing guards such a field today, and a
        // model that wants to must clone it some other way.
        value === undefined ? { $exists: false } : structuredClone(value),
      ];
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
