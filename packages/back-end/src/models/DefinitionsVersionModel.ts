import { getCollection } from "back-end/src/util/mongo.util";
import { logger } from "back-end/src/util/logger";

// One doc per org tracking a monotonic version counter that is bumped by every
// write that can change the `/organization/definitions` response. Lets that
// endpoint short-circuit its expensive reads with a cheap indexed point-read.
// See `touchDefinitionsVersion` for the write side and `getDefinitions` for the
// read side. Not a user-facing resource (no permissions/audit), and the bump
// needs an atomic `$inc` upsert callable with just an orgId, so it's a plain
// collection rather than a BaseModel.
const COLLECTION = "definitionsversions";

interface DefinitionsVersion {
  organization: string;
  version: number;
  dateUpdated: Date;
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
 * A `$inc` counter is used rather than a timestamp so two writes in the same
 * millisecond can't collide into one version. Failures are logged but never
 * propagated — a touch failure must not fail the user's write. A failed bump
 * is retried once: concurrent first-touch upserts can race the unique index
 * (the loser throws E11000, and by the retry the doc exists so it's a plain
 * `$inc`), and a double bump from a spurious retry is harmless.
 */
export async function touchDefinitionsVersion(
  organization: string,
): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await getCollection<DefinitionsVersion>(COLLECTION).updateOne(
        { organization },
        { $inc: { version: 1 }, $set: { dateUpdated: new Date() } },
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
 * Current definitions version for an org. A missing doc means version 0 — the
 * first-ever touch creates it, and pre-deploy data stays static until a write
 * (which touches).
 */
export async function getDefinitionsVersion(
  organization: string,
): Promise<number> {
  const doc = await getCollection<DefinitionsVersion>(COLLECTION).findOne({
    organization,
  });
  return doc?.version ?? 0;
}
