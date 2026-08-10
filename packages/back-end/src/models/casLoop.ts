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
 * An ABSENT field guards on its absence, never on `undefined`: the raw driver
 * runs with `ignoreUndefined`, which strips an undefined clause and leaves the
 * write unconditional.
 *
 * Built from what the read OBSERVED, not from a migrated snapshot — the guard
 * has to describe the stored document.
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
        // CLONED, not referenced: a model's `beforeUpdate` hook runs on a
        // `newDoc` that shares this very object (the read path copies only the
        // top level) and can rewrite it before it reaches the filter — e.g.
        // re-emitting an embedded document in a different key order, which
        // Mongo compares by FIELD ORDER, so the guard never matches and the
        // loop exhausts. `structuredClone` preserves Dates; it would throw on
        // a BSON exotic like ObjectId, which no guarded field uses today.
        value === undefined ? { $exists: false } : structuredClone(value),
      ];
    }),
  );
}

/**
 * Who is allowed to perform a CAS-guarded write, re-asked on the row EVERY
 * attempt: the caller's own permission check ran once, against the row it read,
 * but a retry can land on a row a concurrent rebase moved into a project the
 * caller holds nothing in. Guarding the moved field does NOT close this — it
 * only makes the first attempt lose. Required rather than optional so a write
 * with no authority decision cannot be spelled: supply a check, or state,
 * greppably, which flow already established it.
 */
export type CasAuthority<TSnapshot> =
  /**
   * May be async: the real authority questions here (is this change a PURE
   * revert, a PURE archive) need database proofs a sync check could only
   * approximate.
   */
  | { check: (existing: TSnapshot) => void | Promise<void> }
  /**
   * The calling flow established authority in a way the row cannot re-derive —
   * a merge claim it already holds, a poller running as a resolved user. The
   * string is the reason, written to be read in review.
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
   * Derivation alone can come out too narrow (a conditional read drops out of
   * the guard on attempts that skip the branch; a field read BEFORE the loop
   * is never touched inside it); declaration alone drifts from what the code
   * touches. The union is never narrower than either.
   */
  alsoGuard?: readonly string[];
  maxAttempts?: number;
  /**
   * Fields `compute` reads but only copies through, never decides on. Naming one
   * here is a claim that a concurrent change to it cannot invalidate this write.
   */
  neverGuard?: readonly string[];
  /**
   * Re-read on EVERY attempt: hoisted out of the loop, a retry re-guards on
   * the snapshot that already lost and silently never converges.
   *
   * `null` ends the loop as `not-found`. A caller that refuses the read for
   * its own reasons (an unreadable document) may return `null` too.
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

// Fields every compute may read without guarding: a row's identity, and the
// audit metadata a write stamps rather than decides on.
const ALWAYS_READABLE: ReadonlySet<string> = new Set([
  "id",
  "organization",
  // Immutable once written, so it cannot differ between the read and the write.
  "authorId",
  "dateCreated",
  "__v",
  "_id",
]);

// Records which top-level fields `compute` actually touched.
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
      // A spread reads everything — correctly so; see derivedGuardFields.
      Object.keys(t).forEach((k) => seen.add(k));
      return Reflect.ownKeys(t);
    },
  }) as unknown as TSnapshot;
  return { snapshot: proxy, read: () => seen };
}

// The guard for one attempt: exactly the fields the decision read. Hand-written
// guard lists drift into answering a narrower question than the write performs;
// deriving the list removes the class — what `compute` reads IS what the write
// is conditioned on. A spread reads everything and therefore guards everything,
// which is correct: an update built by spreading the row carries every field
// forward, so a concurrent change to any of them would be clobbered.
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
