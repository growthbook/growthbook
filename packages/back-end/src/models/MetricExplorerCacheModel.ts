import { metricExplorerCachedResult } from "back-end/src/routers/metric-explorer/metric-explorer.validators";
import {
  MetricExplorerCachedResult,
  MetricExplorerConfig,
} from "back-end/types/metric-explorer";
import { MakeModelClass, UpdateProps } from "./BaseModel";

const BaseClass = MakeModelClass({
  schema: metricExplorerCachedResult,
  collectionName: "metricexplorercache",
  idPrefix: "mec_",
  auditLog: {
    entity: "metricExplorerCache",
    createEvent: "metricExplorerCache.create",
    updateEvent: "metricExplorerCache.update",
    deleteEvent: "metricExplorerCache.delete",
  },
  globallyUniqueIds: false,
  additionalIndexes: [
    {
      fields: {
        organization: 1,
        dateCreated: -1,
      },
    },
  ],
});

export class MetricExplorerCacheModel extends BaseClass {
  public getRecentByConfig(config: MetricExplorerConfig) {
    // Oldest date to consider depends on the config's date range
    const oldestDate = new Date();
    if (config.dateRange) {
      switch (config.dateRange) {
        case "last30d":
          oldestDate.setDate(oldestDate.getDate() - 14); // At most 14 days old
          break;
        case "last7d":
          oldestDate.setDate(oldestDate.getDate() - 3); // At most 3 days old
          break;
        case "last24h":
          oldestDate.setDate(oldestDate.getDate() - 1); // At most 1 day old
          break;
        case "custom":
          if (config.customDateRange?.start) {
            const daysAgo = Math.ceil(
              (new Date().getTime() - config.customDateRange.start.getTime()) /
                (1000 * 60 * 60 * 24),
            );

            // Require at least half the range to be within the cache window
            oldestDate.setDate(oldestDate.getDate() - Math.ceil(daysAgo / 2));
          } else {
            oldestDate.setDate(oldestDate.getDate() - 7); // At most 7 days old
          }
          break;
      }
    }

    // All possible matches
    return this._find(
      {
        datasource: config.datasource,
        metricIds: { $all: config.metrics.map((m) => m.id) },
        aggregationType: config.aggregationType,
        dateCreated: { $gte: oldestDate },
      },
      {
        sort: { dateCreated: -1 },
      },
    );
  }

  protected canRead(): boolean {
    return true;
  }
  protected canCreate(doc: MetricExplorerCachedResult): boolean {
    const { datasource } = this.getForeignRefs(doc);
    if (!datasource) {
      throw new Error("Datasource not found");
    }
    return this.context.permissions.canRunMetricQueries({
      projects: datasource?.projects || [],
    });
  }
  protected canUpdate(
    existing: MetricExplorerCachedResult,
    updates: UpdateProps<MetricExplorerCachedResult>,
  ): boolean {
    // Get the datasource from the combined object
    const { datasource: newDatasource } = this.getForeignRefs({
      ...existing,
      ...updates,
    });

    if (!newDatasource) {
      throw new Error("New datasource not found");
    }

    return this.context.permissions.canRunMetricQueries({
      projects: newDatasource.projects || [],
    });
  }
  protected canDelete(): boolean {
    return false;
  }
}
