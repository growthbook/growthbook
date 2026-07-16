import {
  InsightsFindCache,
  insightsFindCache,
} from "back-end/src/validators/insights-find-cache";
import { MakeModelClass } from "./BaseModel";

// Entries older than this are treated as expired and overwritten on the
// next write. The TTL is short on purpose: saved insights, experiment
// analyses, and prompt config all change the right answer over time.
export const INSIGHTS_FIND_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

const BaseClass = MakeModelClass({
  schema: insightsFindCache,
  collectionName: "insightsfindcache",
  idPrefix: "insfc_",
  additionalIndexes: [
    {
      fields: { organization: 1, key: 1 },
      unique: true,
    },
  ],
});

export class InsightsFindCacheModel extends BaseClass {
  // The cache is internal plumbing, not a user-facing resource. Access
  // control happens upstream: the cache key is derived from the set of
  // experiments the requesting user was able to read, so two users with
  // different permissions can never share an entry.
  protected canRead(): boolean {
    return true;
  }
  protected canCreate(): boolean {
    return true;
  }
  protected canUpdate(): boolean {
    return true;
  }
  protected canDelete(): boolean {
    return true;
  }

  public async getValidByKey(key: string): Promise<InsightsFindCache | null> {
    const entry = await this._findOne({ key });
    if (!entry) return null;
    if (Date.now() - entry.dateUpdated.getTime() > INSIGHTS_FIND_CACHE_TTL_MS) {
      return null;
    }
    return entry;
  }

  public async set(
    key: string,
    value: Pick<
      InsightsFindCache,
      "suggestions" | "numExperimentsRequested" | "numExperimentsAnalyzed"
    >,
  ): Promise<void> {
    const existing = await this._findOne({ key });
    if (existing) {
      await this.update(existing, value);
    } else {
      await this.create({ key, ...value });
    }
  }
}
