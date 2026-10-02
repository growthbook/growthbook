import { queryUsageValidator } from "shared/validators";
import { MakeModelClass } from "./BaseModel";

// About 13 months, so a month can be compared with the same month a year earlier
const RETENTION_SECONDS = 400 * 24 * 60 * 60;

const BaseClass = MakeModelClass({
  schema: queryUsageValidator,
  collectionName: "queryusages",
  idPrefix: "qu_",
  additionalIndexes: [
    { fields: { organization: 1, datasource: 1, dateCreated: -1 } },
    { fields: { dateCreated: 1 }, expireAfterSeconds: RETENTION_SECONDS },
  ],
});

// Written by recordQueryUsage for every warehouse query; rows are never edited.
export class QueryUsageModel extends BaseClass {
  protected canRead() {
    return this.context.permissions.canViewUsage();
  }
  // Recorded no matter who (or what job) triggered the query
  protected canCreate() {
    return true;
  }
  protected canUpdate() {
    return false;
  }
  protected canDelete() {
    return false;
  }
}
