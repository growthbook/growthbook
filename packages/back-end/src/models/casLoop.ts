/** Shared read/compute/guard/write retry loop for BaseModel and feature revisions. */

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

// Guard stored values directly; absent fields require $exists:false because undefined is stripped.
export function buildCasGuard(
  guardFields: readonly string[],
  observed: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    guardFields.map((f) => {
      const value = observed[f];
      return [
        f,
        // beforeUpdate may mutate shared nested references; Mongo compares object field order.
        value === undefined ? { $exists: false } : structuredClone(value),
      ];
    }),
  );
}

// Recheck authority on every retry because a concurrent move can change scope.
export type CasAuthority<TSnapshot> =
  /** Async checks may perform purity lookups. */
  | { check: (existing: TSnapshot) => void | Promise<void> }
  /** Documents why the calling flow has already established authority. */
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

const ALWAYS_READABLE: ReadonlySet<string> = new Set([
  "id",
  "organization",
  // Immutable once written, so it cannot differ between the read and the write.
  "authorId",
  "dateCreated",
  "__v",
  "_id",
]);

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

// Guard every field compute reads; spreading the row therefore guards all fields.
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
