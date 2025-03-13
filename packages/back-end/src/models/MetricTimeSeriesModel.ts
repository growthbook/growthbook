import {
  metricTimeSeriesSchema,
  MetricTimeSeries,
  CreateMetricTimeSeries,
} from "back-end/src/validators/metric-time-series";
import { MakeModelClass } from "./BaseModel";

const BaseClass = MakeModelClass({
  schema: metricTimeSeriesSchema,
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

  public async deleteMetricTimeSeriesBySource(
    source: MetricTimeSeries["source"],
    sourceId: MetricTimeSeries["sourceId"]
  ) {
    await this._dangerousGetCollection().deleteMany({
      source,
      sourceId,
    });
  }

  public async bulkCreate(metricTimeSeries: CreateMetricTimeSeries[]) {
    // TODO: Fix this as it's not safe
    await this.deleteMetricTimeSeriesBySource(
      metricTimeSeries[0].source,
      metricTimeSeries[0].sourceId
    );

    await this._dangerousGetCollection().insertMany(
      metricTimeSeries.map((mts) => ({
        ...mts,
        id: this._generateId(),
        organization: this.context.org.id,
        dateCreated: new Date(),
        dateUpdated: new Date(),
      }))
    );
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
        if (
          mts.lastExperimentSettingsHash !== existing.lastExperimentSettingsHash
        ) {
          mts.dataPoints[0].tags = ["experiment-settings-changed"];
        }

        if (mts.lastMetricSettingsHash !== existing.lastMetricSettingsHash) {
          mts.dataPoints[0].tags = ["metric-settings-changed"];
        }

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
                lastExperimentSettingsHash: u.lastExperimentSettingsHash,
                lastMetricSettingsHash: u.lastMetricSettingsHash,
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
