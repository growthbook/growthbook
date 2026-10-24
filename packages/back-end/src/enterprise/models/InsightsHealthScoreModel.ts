import {
  InsightsHealthScoreInterface,
  insightsHealthScoreValidator,
} from "shared/validators";
import { MakeModelClass } from "back-end/src/models/BaseModel";

const BaseClass = MakeModelClass({
  schema: insightsHealthScoreValidator,
  collectionName: "insightshealthscores",
  idPrefix: "ihs_",
  readonlyFields: ["project", "weekStart"],
  globallyUniquePrimaryKeys: false,
  additionalIndexes: [
    {
      fields: { organization: 1, project: 1, weekStart: 1 },
      unique: true,
    },
  ],
});

// Computed by the server from every experiment, never edited by users
export class InsightsHealthScoreModel extends BaseClass {
  protected canRead(doc: InsightsHealthScoreInterface): boolean {
    // "" checks organization-level read access, since that row spans every Project
    return this.context.permissions.canReadSingleProjectResource(doc.project);
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
    return this._findOne({ project: "", weekStart }).then((doc) => !!doc);
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
