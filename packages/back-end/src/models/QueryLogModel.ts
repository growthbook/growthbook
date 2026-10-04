import { queryLogValidator } from "shared/validators";
import type { DataSourceInterface } from "shared/types/datasource";
import type {
  DataSourceUsage,
  QueryLogInterface,
  QueryLogUsage,
  QueryLogUsageGroup,
} from "shared/types/query";
import { MakeModelClass } from "./BaseModel";

// About 13 months, so a month can be compared with the same month a year earlier
const RETENTION_SECONDS = 400 * 24 * 60 * 60;

const USAGE_SUMS = {
  queries: { $sum: 1 },
  durationMs: { $sum: "$durationMs" },
  executionDurationMs: { $sum: "$statistics.executionDurationMs" },
  bytesProcessed: { $sum: "$statistics.bytesProcessed" },
  bytesBilled: { $sum: "$statistics.bytesBilled" },
  totalSlotMs: { $sum: "$statistics.totalSlotMs" },
};

type UsageRow = QueryLogUsage & { _id: string | null };

const BaseClass = MakeModelClass({
  schema: queryLogValidator,
  collectionName: "querylogs",
  idPrefix: "qlog_",
  additionalIndexes: [
    { fields: { organization: 1, datasource: 1, dateCreated: -1 } },
    { fields: { dateCreated: 1 }, expireAfterSeconds: RETENTION_SECONDS },
  ],
});

// Written by recordQueryLog for every warehouse query; rows are never edited.
export class QueryLogModel extends BaseClass {
  protected canRead(doc: QueryLogInterface) {
    const { datasource } = this.getForeignRefs(doc, false);
    return this.context.permissions.canReadMultiProjectResource(
      datasource?.projects || [],
    );
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

  // Checks the data source once instead of every row
  private assertCanReadDatasource(datasource: DataSourceInterface) {
    if (
      !this.context.permissions.canReadMultiProjectResource(
        datasource.projects || [],
      )
    ) {
      this.context.permissions.throwPermissionError();
    }
  }

  public async getRecentByDatasource(
    datasource: DataSourceInterface,
    limit: number = 50,
  ) {
    this.assertCanReadDatasource(datasource);
    return this._find(
      { datasource: datasource.id },
      { sort: { dateCreated: -1 }, limit, bypassReadPermissionChecks: true },
    );
  }

  public async getUsageByDatasource(
    datasource: DataSourceInterface,
    since: Date,
  ): Promise<DataSourceUsage> {
    this.assertCanReadDatasource(datasource);
    const group = (field: string | null) => ({
      $group: { _id: field, ...USAGE_SUMS },
    });
    const [result] = await this._dangerousGetCollection()
      .aggregate<Record<keyof DataSourceUsage, UsageRow[]>>([
        {
          $match: {
            organization: this.context.org.id,
            datasource: datasource.id,
            dateCreated: { $gte: since },
          },
        },
        {
          $facet: {
            total: [group(null)],
            factTables: [{ $unwind: "$factTableIds" }, group("$factTableIds")],
            experiments: [
              { $match: { experimentId: { $nin: [null, ""] } } },
              group("$experimentId"),
            ],
            users: [group("$userId")],
            queryTypes: [group("$queryType")],
          },
        },
      ])
      .toArray();

    const toGroups = (rows: UsageRow[] = []): QueryLogUsageGroup[] =>
      rows.map(({ _id, ...usage }) => ({ id: _id ?? null, ...usage }));
    const [total] = toGroups(result?.total);
    return {
      total: total ?? {
        queries: 0,
        durationMs: 0,
        executionDurationMs: 0,
        bytesProcessed: 0,
        bytesBilled: 0,
        totalSlotMs: 0,
      },
      factTables: toGroups(result?.factTables),
      experiments: toGroups(result?.experiments),
      users: toGroups(result?.users),
      queryTypes: toGroups(result?.queryTypes),
    };
  }
}
