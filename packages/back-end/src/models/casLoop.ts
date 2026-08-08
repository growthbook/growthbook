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
 * Guard completeness is checked in tests only: it costs a Proxy per attempt, and the
 * suite is where an under-guarded write should fail rather than in production.
 */
const ENFORCE_GUARD_COMPLETENESS = process.env.NODE_ENV === "test";

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
  | { check: (existing: TSnapshot) => void }
  /**
   * The calling flow established authority in a way the row cannot re-derive — a
   * merge claim it already holds, a poller running as a resolved user. The string is
   * the reason, and it is there to be read in review.
   */
  | { authorizedByFlow: string };

export function assertCasAuthority<TSnapshot>(
  authority: CasAuthority<TSnapshot>,
  existing: TSnapshot,
): void {
  if ("check" in authority) authority.check(existing);
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
  allowUnguardedReads,
  read,
  compute,
  write,
}: {
  guardFields: readonly string[];
  maxAttempts?: number;
  /**
   * Fields `compute` may read WITHOUT guarding on them — identity and metadata it
   * only copies through, never decides on. Everything else it touches must be in
   * `guardFields`; see `assertDecisionIsGuarded`.
   */
  allowUnguardedReads?: readonly string[];
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
    assertDecisionIsGuarded(guardFields, watched.read(), allowUnguardedReads);

    const written = await write(
      update,
      buildCasGuard(guardFields, current.observed),
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
  if (
    !ENFORCE_GUARD_COMPLETENESS ||
    !snapshot ||
    typeof snapshot !== "object"
  ) {
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
 * A CAS guard must cover every field the decision it protects actually read.
 *
 * This is the single most repeated defect class in the revision engines: a guard
 * that answers a narrower question than the write performs. `merge` guarded `status`
 * while the caller's desired state came from `target`; the comment verbs guarded
 * `reviews` while deciding on `status`; the schedule scrub guarded the schedule while
 * deciding on the status. Every one was expressible because the field list is written
 * by hand and nothing compares it to what the code touches.
 *
 * Enforced in tests only — zero production cost, and the suite is where a new
 * under-guarded write shows up before review does.
 */
function assertDecisionIsGuarded(
  guardFields: readonly string[],
  readFields: Set<string>,
  allowUnguardedReads: readonly string[] = [],
): void {
  if (!ENFORCE_GUARD_COMPLETENESS) return;
  // A `dateUpdated` guard is optimistic concurrency over the WHOLE document, and
  // every write through this layer stamps it — so it already subsumes any field list.
  // Demanding per-field guards on top would be strictly weaker advice.
  if (guardFields.includes("dateUpdated")) return;
  const allowed = new Set([...guardFields, ...allowUnguardedReads]);
  const unguarded = [...readFields].filter(
    (f) => !allowed.has(f) && !ALWAYS_READABLE.has(f),
  );
  if (!unguarded.length) return;
  throw new Error(
    `CAS decision read unguarded field(s) [${unguarded.join(", ")}] — add them to ` +
      `guardFields, or to allowUnguardedReads if the write only copies them through. ` +
      `Guarded: [${[...guardFields].join(", ")}].`,
  );
}
