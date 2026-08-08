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

/**
 * Who is allowed to perform a CAS-guarded write, re-asked on the row EVERY attempt.
 *
 * Required, never optional, and that is the whole point. A caller's own permission
 * check runs once, against the row it read; the loop then re-reads on each retry and
 * can land on a row a concurrent rebase moved into a project the caller holds nothing
 * in. Guarding the moved field does NOT close this — the guard makes the first attempt
 * lose, and the retry proceeds against the new row.
 *
 * An optional callback made "no check at all" the default, which is how five verbs
 * ended up without one. Making it required means a write with no authority decision
 * cannot be spelled: the author must either supply a check or state, greppably, which
 * flow already established it.
 */
export type CasAuthority<TSnapshot> =
  /**
   * May be async: the real authority questions here involve proofs that hit the
   * database (is this change a PURE revert, a PURE archive), and a sync-only check
   * could only approximate them by asking which atoms the caller holds. That
   * approximation is weaker than the caller's own gate — it admits a retry against
   * content a concurrent rebase broadened.
   */
  | { check: (existing: TSnapshot) => void | Promise<void> }
  /**
   * The calling flow established authority in a way the row cannot re-derive — a
   * merge claim it already holds, a poller running as a resolved user. The string is
   * the reason, and it is there to be read in review.
   */
  | { authorizedByFlow: string };

export async function assertCasAuthority<TSnapshot>(
  authority: CasAuthority<TSnapshot>,
  existing: TSnapshot,
): Promise<void> {
  if ("check" in authority) await authority.check(existing);
}

/** What one attempt's read yields: the value `compute` sees, and what to guard on. */
export type CasRead<TSnapshot> = {
  snapshot: TSnapshot;
  /** The stored document as read, for the guard. Often the same object as `snapshot`. */
  observed: Record<string, unknown>;
};

export async function runCasLoop<TSnapshot, TUpdate, TResult>({
  alsoGuard,
  maxAttempts = 5,
  neverGuard,
  read,
  compute,
  write,
}: {
  /**
   * Fields the caller declares, UNIONED with what `compute` actually read.
   *
   * Both halves are needed. Derivation alone can come out narrower than intended:
   * a conditional read (`armAcknowledgments`, only touched when arming) would drop
   * out of the guard on the attempts that skip that branch, and a caller that
   * computed its desired state from a field BEFORE the loop never touches it inside.
   * Declaration alone was the original defect — the list is written by hand and
   * nothing compared it to what the code touches.
   *
   * The union is never narrower than either, so it cannot regress a guard, and it
   * closes the six under-guarded writes the derivation found.
   */
  alsoGuard?: readonly string[];
  maxAttempts?: number;
  /**
   * Fields `compute` reads but only copies through, never decides on. Naming one
   * here is a claim that a concurrent change to it cannot invalidate this write.
   */
  neverGuard?: readonly string[];
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

    const watched = watchFieldReads(current.snapshot);
    const update = await compute(watched.snapshot);
    if (!update) return { status: "aborted" };

    const written = await write(
      update,
      buildCasGuard(
        derivedGuardFields(watched.read(), alsoGuard, neverGuard),
        current.observed,
      ),
      current.snapshot,
    );
    if (written.applied) return { status: "applied", result: written.result };
  }
  return { status: "exhausted" };
}

/**
 * Fields every compute may read without guarding: a row's identity, and the audit
 * metadata a write stamps rather than decides on.
 */
const ALWAYS_READABLE: ReadonlySet<string> = new Set([
  "id",
  "organization",
  // Immutable once written, so a decision may read it without guarding: it cannot
  // differ between the read and the write.
  "authorId",
  "dateCreated",
  "__v",
  "_id",
]);

/** Records which top-level fields `compute` actually touched. */
function watchFieldReads<TSnapshot>(snapshot: TSnapshot): {
  snapshot: TSnapshot;
  read: () => Set<string>;
} {
  if (!snapshot || typeof snapshot !== "object") {
    return { snapshot, read: () => new Set() };
  }
  const seen = new Set<string>();
  const proxy = new Proxy(snapshot as unknown as Record<string, unknown>, {
    get(t, prop, r) {
      if (typeof prop === "string") seen.add(prop);
      return Reflect.get(t, prop, r);
    },
    ownKeys(t) {
      // A spread reads everything, and that is not a false positive: an update built
      // by spreading the row carries every field forward, so a concurrent change to
      // any of them is being clobbered.
      Object.keys(t).forEach((k) => seen.add(k));
      return Reflect.ownKeys(t);
    },
  }) as unknown as TSnapshot;
  return { snapshot: proxy, read: () => seen };
}

/**
 * The guard for one attempt: exactly the fields the decision read.
 *
 * Hand-written guard lists were the most repeated defect in these engines — a guard
 * answering a narrower question than the write performs. The list was written by
 * hand and nothing compared it to what the code touched, so `merge` guarded `status`
 * while deciding on `target`, the comment verbs guarded `reviews` while deciding on
 * `status`, and the schedule scrub guarded the schedule while deciding on the status.
 *
 * Deriving it removes the class: what `compute` reads IS what it is conditioned on.
 * A spread reads everything and therefore guards everything, which is correct — an
 * update built by spreading the row carries every field forward.
 */
function derivedGuardFields(
  readFields: Set<string>,
  alsoGuard: readonly string[] = [],
  neverGuard: readonly string[] = [],
): string[] {
  const skip = new Set([...ALWAYS_READABLE, ...neverGuard]);
  return [
    ...new Set([...[...readFields].filter((f) => !skip.has(f)), ...alsoGuard]),
  ];
}
