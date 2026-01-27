import {
  StatsShadowComparison,
  statsShadowComparisonValidator,
} from "shared/validators";
import { MakeModelClass } from "./BaseModel";

const COLLECTION_NAME = "stats_shadow_comparisons";

const BaseClass = MakeModelClass({
  schema: statsShadowComparisonValidator,
  collectionName: COLLECTION_NAME,
  idPrefix: "ssc_",
  globallyUniqueIds: false,
  additionalIndexes: [
    // For cleanup queries by date
    {
      fields: {
        organization: 1,
        dateCreated: -1,
      },
    },
    // For finding mismatches
    {
      fields: {
        organization: 1,
        status: 1,
      },
    },
    // For experiment-specific lookups
    {
      fields: {
        experimentId: 1,
      },
    },
  ],
});

export class StatsShadowComparisonModel extends BaseClass {
  /**
   * Shadow comparisons are internal testing data.
   * Permission checks are simple org-level access.
   */
  protected canRead(): boolean {
    // Any user in the org can read shadow comparisons
    return true;
  }

  protected canCreate(): boolean {
    // Shadow comparisons are created automatically by the system
    // No special permissions needed beyond org membership
    return true;
  }

  protected canUpdate(): boolean {
    // Shadow comparisons should not be updated after creation
    return false;
  }

  protected canDelete(): boolean {
    // Shadow comparisons should be cleaned up via database admin
    // Not through the application layer
    return false;
  }

  /**
   * Find all mismatches for review.
   */
  public async findMismatches(limit: number = 100) {
    return this._find(
      { status: { $in: ["mismatch", "ts_error"] } },
      { sort: { dateCreated: -1 }, limit },
    );
  }

  /**
   * Find recent comparisons for an experiment.
   */
  public async findByExperiment(experimentId: string, limit: number = 10) {
    return this._find({ experimentId }, { sort: { dateCreated: -1 }, limit });
  }

  /**
   * Count comparisons by status for monitoring.
   */
  public async countByStatus(): Promise<{
    match: number;
    mismatch: number;
    ts_error: number;
  }> {
    const results = await this._find({}, { limit: 10000 });
    return {
      match: results.filter((r) => r.status === "match").length,
      mismatch: results.filter((r) => r.status === "mismatch").length,
      ts_error: results.filter((r) => r.status === "ts_error").length,
    };
  }
}
