import {
  HEALTH_SCORE_ALL_PROJECTS,
  InsightsHealthScoreInterface,
  insightsHealthScoreValidator,
} from "shared/validators";
import { MakeModelClass } from "back-end/src/models/BaseModel";

export const INSIGHTS_HEALTH_SCORES_COLLECTION = "insightshealthscores";

const BaseClass = MakeModelClass({
  schema: insightsHealthScoreValidator,
  collectionName: INSIGHTS_HEALTH_SCORES_COLLECTION,
  idPrefix: "ihs_",
  readonlyFields: ["scope", "weekStart"],
  globallyUniquePrimaryKeys: false,
  additionalIndexes: [
    {
      fields: { organization: 1, scope: 1, weekStart: 1 },
      unique: true,
    },
    // The daily job's cross-org lookup by week
    { fields: { weekStart: 1, scope: 1 } },
  ],
});

// Computed by the server from every experiment, never edited by users
export class InsightsHealthScoreModel extends BaseClass {
  protected canRead(doc: InsightsHealthScoreInterface): boolean {
    // "" checks organization-level read access, since that row spans every Project
    return this.context.permissions.canReadSingleProjectResource(
      doc.scope === HEALTH_SCORE_ALL_PROJECTS ? "" : doc.scope,
    );
  }
  protected canCreate(doc: InsightsHealthScoreInterface): boolean {
    return this.canRead(doc);
  }
  protected canUpdate(): boolean {
    return false;
  }
  protected canDelete(): boolean {
    return false;
  }

  public getSince(since: Date): Promise<InsightsHealthScoreInterface[]> {
    return this._find({ weekStart: { $gte: since } });
  }

  public hasWeek(weekStart: Date): Promise<boolean> {
    return this._findOne({
      scope: HEALTH_SCORE_ALL_PROJECTS,
      weekStart,
    }).then((doc) => !!doc);
  }

  public record(
    scores: Omit<
      InsightsHealthScoreInterface,
      "id" | "organization" | "dateCreated" | "dateUpdated"
    >,
  ) {
    return this._createOne(scores);
  }
}
