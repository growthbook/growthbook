import {
  metricTimeSeries,
  MetricTimeSeries,
  CreateMetricTimeSeries,
} from "back-end/src/validators/metric-time-series";
import { MakeModelClass } from "./BaseModel";

const BaseClass = MakeModelClass({
  schema: metricTimeSeries,
  collectionName: "metrictimeseries",
  idPrefix: "mts_",
  additionalIndexes: [
    {
      unique: true,
      fields: {
        organization: 1,
        source: 1,
        sourceId: 1,
        metricId: 1,
      },
    },
  ],
});

export class MetricTimeSeriesModel extends BaseClass {
  // Allow everyone to create as these will be managed automatically and not exposed directly to users
  protected canCreate(): boolean {
    return true;
  }
  protected canRead(): boolean {
    return true;
  }
  protected canUpdate(): boolean {
    return true;
  }
  protected canDelete(): boolean {
    return true;
  }

  public async getMetricTimeSeriesBySource(
    source: MetricTimeSeries["source"],
    sourceId: MetricTimeSeries["sourceId"],
    metricIds: Array<MetricTimeSeries["metricId"]>
  ) {
    return this._find({ source, sourceId, metricId: { $in: metricIds } });
  }

  public async bulkCreateOrUpdate(metricTimeSeries: CreateMetricTimeSeries[]) {
    const existingMetricTimeSeries = await this.getMetricTimeSeriesBySource(
      metricTimeSeries[0].source,
      metricTimeSeries[0].sourceId,
      metricTimeSeries.map((mts) => mts.metricId)
    );

    const updates: MetricTimeSeries[] = [];
    const toCreate: CreateMetricTimeSeries[] = [];

    metricTimeSeries.forEach((mts) => {
      const existing = existingMetricTimeSeries.find(
        (emts) => emts.metricId === mts.metricId
      );

      if (existing) {
        updates.push({
          ...existing,
          ...mts,
          dataPoints: [...existing.dataPoints, ...mts.dataPoints],
          dateUpdated: new Date(),
        });
      } else {
        toCreate.push({
          ...mts,
          // @ts-expect-error - ignore these, need to figure out a better way
          id: this._generateId(),
          organization: this.context.org.id,
          dateCreated: new Date(),
          dateUpdated: new Date(),
        });
      }
    });

    // TODO: Should we integrate with BaseModel and add hooks?
    if (toCreate.length > 0) {
      await this._dangerousGetCollection().insertMany(toCreate);
    }

    if (updates.length > 0) {
      await this._dangerousGetCollection().bulkWrite(
        updates.map((u) => ({
          updateOne: {
            filter: { id: u.id },
            update: {
              $set: {
                lastSettingsHash: u.lastSettingsHash,
                dataPoints: u.dataPoints,
                dateUpdated: new Date(),
              },
            },
          },
        }))
      );
    }
  }
}
