import { getCollection } from "back-end/src/util/mongo.util";
import { logger } from "back-end/src/util/logger";

// One doc per org tracking the version counters that back the
// `/organization/definitions` ETag, letting that endpoint short-circuit its
// expensive reads with a cheap indexed point-read. See `touchDefinitionsVersion`
// for the write side and `getDefinitions` for the read side. Not a user-facing
// resource (no permissions/audit), and the bump needs an atomic `$inc` upsert
// callable with just an orgId, so it's a plain collection rather than a
// BaseModel.
//
// The response is permission-filtered by project, so a single org-wide counter
// would invalidate every user's cache on any write — including users who can't
// read the project that changed. We therefore keep a `version` counter for
// changes that affect everyone (org-wide resources, all-projects writes) plus a
// `projectVersions` map bumped only for the affected project(s). A reader's
// ETag folds in the global counter and the versions of just the projects they
// can read, so a write in project A no longer busts a project-B-only reader's
// cache. A global bump is always a safe superset — it over-invalidates but can
// never serve stale data — so any write whose project scope is unknown falls
// back to `"global"`.
const COLLECTION = "definitionsversions";

interface DefinitionsVersion {
  organization: string;
  version: number;
  projectVersions?: Record<string, number>;
  dateUpdated: Date;
}

// "global" bumps the org-wide counter (invalidates every reader); a list of
// project ids bumps only those projects' counters. An empty/undefined project
// set means "all projects" and must map to "global" — see `definitionsScope`.
export type DefinitionsVersionScope = "global" | string[];

export interface DefinitionsVersionState {
  version: number;
  projectVersions: Record<string, number>;
}

/**
 * Normalize one or more project lists into a scope. Any list that is empty or
 * undefined means "all projects" (the GrowthBook convention), which affects
 * every reader → "global". Pass both the old and new project lists on an update
 * so a reassignment invalidates readers of either side.
 */
export function definitionsScope(
  ...projectLists: (string[] | undefined)[]
): DefinitionsVersionScope {
  const projects = new Set<string>();
  for (const list of projectLists) {
    if (!list || list.length === 0) return "global";
    for (const p of list) if (p) projects.add(p);
  }
  return projects.size ? [...projects] : "global";
}

// Ensure a single doc per org so concurrent first-touch upserts can't create
// duplicates (which would make the version non-monotonic). Called at startup.
export async function ensureDefinitionsVersionIndex(): Promise<void> {
  await getCollection<DefinitionsVersion>(COLLECTION).createIndex(
    { organization: 1 },
    { unique: true },
  );
}

/**
 * Bump an org's definitions version. Call this AFTER the DB write it reflects
 * has committed (see the ordering rule in `getDefinitions`): a reader
 * interleaving between the write and this bump gets fresh data under the old
 * ETag → harmless extra 200. The reverse order would cache old data under the
 * new ETag → permanent staleness.
 *
 * `scope` restricts which readers are invalidated: "global" bumps the org-wide
 * counter (every reader), a project list bumps only those projects' counters
 * (readers who can read one of them). When in doubt use "global" — it's a safe
 * superset that never serves stale data.
 *
 * A `$inc` counter is used rather than a timestamp so two writes in the same
 * millisecond can't collide into one version. Failures are logged but never
 * propagated — a touch failure must not fail the user's write. A failed bump
 * is retried once: concurrent first-touch upserts can race the unique index
 * (the loser throws E11000, and by the retry the doc exists so it's a plain
 * `$inc`), and a double bump from a spurious retry is harmless.
 */
export async function touchDefinitionsVersion(
  organization: string,
  scope: DefinitionsVersionScope = "global",
): Promise<void> {
  const inc: Record<string, number> =
    scope === "global"
      ? { version: 1 }
      : Object.fromEntries(scope.map((p) => [`projectVersions.${p}`, 1]));

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await getCollection<DefinitionsVersion>(COLLECTION).updateOne(
        { organization },
        { $inc: inc, $set: { dateUpdated: new Date() } },
        { upsert: true },
      );
      return;
    } catch (e) {
      if (attempt > 0) {
        logger.error(
          e,
          `Failed to bump definitions version for organization ${organization}`,
        );
      }
    }
  }
}

/**
 * Current definitions version state for an org. A missing doc means version 0
 * with no per-project counters — the first-ever touch creates it, and
 * pre-deploy data stays static until a write (which touches).
 */
export async function getDefinitionsVersionState(
  organization: string,
): Promise<DefinitionsVersionState> {
  const doc = await getCollection<DefinitionsVersion>(COLLECTION).findOne({
    organization,
  });
  return {
    version: doc?.version ?? 0,
    projectVersions: doc?.projectVersions ?? {},
  };
}
