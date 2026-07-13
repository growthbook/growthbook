import mongoose from "mongoose";
import { logger } from "back-end/src/util/logger";

// One doc per org tracking a monotonic version counter that is bumped by every
// write that can change the `/organization/definitions` response. Lets that
// endpoint short-circuit its expensive reads with a cheap indexed point-read.
// See `touchDefinitionsVersion` for the write side and `getDefinitions` for the
// read side.
const definitionsVersionSchema = new mongoose.Schema({
  organization: {
    type: String,
    unique: true,
  },
  version: Number,
  dateUpdated: Date,
});

interface DefinitionsVersionDocument extends mongoose.Document {
  organization: string;
  version: number;
  dateUpdated: Date;
}

const DefinitionsVersionModel = mongoose.model<DefinitionsVersionDocument>(
  "DefinitionsVersion",
  definitionsVersionSchema,
);

/**
 * Bump an org's definitions version. Call this AFTER the DB write it reflects
 * has committed (see the ordering rule in `getDefinitions`): a reader
 * interleaving between the write and this bump gets fresh data under the old
 * ETag → harmless extra 200. The reverse order would cache old data under the
 * new ETag → permanent staleness.
 *
 * A `$inc` counter is used rather than a timestamp so two writes in the same
 * millisecond can't collide into one version. Failures are logged but never
 * propagated — a touch failure must not fail the user's write.
 */
export async function touchDefinitionsVersion(
  organization: string,
): Promise<void> {
  try {
    await DefinitionsVersionModel.updateOne(
      { organization },
      { $inc: { version: 1 }, $set: { dateUpdated: new Date() } },
      { upsert: true },
    );
  } catch (e) {
    logger.error(
      e,
      `Failed to bump definitions version for organization ${organization}`,
    );
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
  const doc = await DefinitionsVersionModel.findOne({ organization });
  return doc?.version ?? 0;
}
