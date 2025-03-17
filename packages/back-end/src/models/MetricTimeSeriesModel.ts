import uniqid from "uniqid";
import { formatISO } from "date-fns";
import {
  metricTimeSeriesSchema,
  MetricTimeSeries,
  CreateMetricTimeSeries,
  CreateMetricTimeSeriesSingleDataPoint,
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

  public async getBySourceAndMetricIds(
    source: MetricTimeSeries["source"],
    sourceId: MetricTimeSeries["sourceId"],
    metricIds: Array<MetricTimeSeries["metricId"]>
  ) {
    return this._find({ source, sourceId, metricId: { $in: metricIds } });
  }

  public async deleteAllBySource(
    source: MetricTimeSeries["source"],
    sourceId: MetricTimeSeries["sourceId"]
  ) {
    await this._dangerousGetCollection().deleteMany({
      organization: this.context.org.id,
      source,
      sourceId,
    });
  }

  public async findMany(
    metricTimeSeriesIdentifiers: Pick<
      CreateMetricTimeSeries,
      "source" | "sourceId" | "metricId"
    >[]
  ) {
    const metricTimeSeriesPerSource = new Map<string, string[]>();
    metricTimeSeriesIdentifiers.forEach((mts) => {
      const sourceIdentifier = `${mts.source}::${mts.sourceId}`;
      if (!metricTimeSeriesPerSource.has(sourceIdentifier)) {
        metricTimeSeriesPerSource.set(sourceIdentifier, []);
      }
      metricTimeSeriesPerSource.get(sourceIdentifier)!.push(mts.metricId);
    });

    const allPromises = Array.from(
      metricTimeSeriesPerSource.entries()
    ).map(([sourceIdentifier, metricIds]) =>
      this.getBySourceAndMetricIds(
        sourceIdentifier.split("::")[0] as MetricTimeSeries["source"],
        sourceIdentifier.split("::")[1],
        metricIds
      )
    );

    const allResults = await Promise.all(allPromises);
    return allResults.flat();
  }

  /**
   * If the existing source/metricId record already exists, it will be updated with the
   * new data point being added to the end of the dataPoints array.
   * If the record does not exist, it will be created.
   */
  public async upsertMultipleSingleDataPoint(
    metricTimeSeries: CreateMetricTimeSeriesSingleDataPoint[]
  ) {
    const existingMetricTimeSeries = await this.findMany(metricTimeSeries);

    const toCreate: CreateMetricTimeSeries[] = [];
    const toUpdate: MetricTimeSeries[] = [];

    metricTimeSeries.forEach((mts) => {
      const existing = existingMetricTimeSeries.find(
        (existing) =>
          existing.source === mts.source &&
          existing.sourceId === mts.sourceId &&
          existing.metricId === mts.metricId
      );

      if (existing) {
        toUpdate.push(this.getUpdatedMetricTimeSeries(existing, mts));
      } else {
        toCreate.push(this.getNewMetricTimeSeries(mts));
      }
    });

    if (toCreate.length > 0) {
      await this._dangerousGetCollection().insertMany(toCreate, {
        ignoreUndefined: true,
      });
    }

    if (toUpdate.length > 0) {
      await this._dangerousGetCollection().bulkWrite(
        toUpdate.map((u) => ({
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
        })),
        { ignoreUndefined: true }
      );
    }
  }

  private getUpdatedMetricTimeSeries(
    existing: MetricTimeSeries,
    newTimeSeries: CreateMetricTimeSeriesSingleDataPoint
  ): MetricTimeSeries {
    if (
      newTimeSeries.lastExperimentSettingsHash !==
      existing.lastExperimentSettingsHash
    ) {
      if (!newTimeSeries.singleDataPoint.tags) {
        newTimeSeries.singleDataPoint.tags = [];
      }
      newTimeSeries.singleDataPoint.tags.push("experiment-settings-changed");
    }

    if (
      newTimeSeries.lastMetricSettingsHash !== existing.lastMetricSettingsHash
    ) {
      if (!newTimeSeries.singleDataPoint.tags) {
        newTimeSeries.singleDataPoint.tags = [];
      }
      newTimeSeries.singleDataPoint.tags.push("metric-settings-changed");
    }

    const dataPoints = this.limitTimeSeriesDataPoints([
      ...existing.dataPoints,
      newTimeSeries.singleDataPoint,
    ]);

    return metricTimeSeriesSchema.strip().parse({
      ...existing,
      lastMetricSettingsHash: newTimeSeries.lastMetricSettingsHash,
      lastExperimentSettingsHash: newTimeSeries.lastExperimentSettingsHash,
      dataPoints,
      dateUpdated: new Date(),
    });
  }

  private getNewMetricTimeSeries(
    newTimeSeries: CreateMetricTimeSeriesSingleDataPoint
  ): MetricTimeSeries {
    return metricTimeSeriesSchema.strip().parse({
      ...newTimeSeries,
      dataPoints: [newTimeSeries.singleDataPoint],

      id: uniqid("mts_"),
      organization: this.context.org.id,
      dateCreated: new Date(),
      dateUpdated: new Date(),
    });
  }

  /**
   * Organizes data points by day and limits the total to 300 most recent points
   * Keeps all tagged data points and at least one untagged point per day
   */
  private limitTimeSeriesDataPoints(
    dataPoints: MetricTimeSeries["dataPoints"]
  ) {
    const lastDataPointPerDay = dataPoints.reduceRight((acc, dataPoint) => {
      const dateKey = formatISO(dataPoint.date, { representation: "date" });
      if (dataPoint.tags && dataPoint.tags.length > 0) {
        if (!acc.has(dateKey)) {
          acc.set(dateKey, []);
        }
        acc.get(dateKey)!.push(dataPoint);
      } else {
        if (!acc.has(dateKey)) {
          acc.set(dateKey, [dataPoint]);
        }
      }
      return acc;
    }, new Map<string, typeof dataPoints>());

    // Order of array is defined by order of insertion, which is the opposite of the desired order
    const sortedDataPoints = Array.from(lastDataPointPerDay.values())
      .flat()
      .reverse();

    if (sortedDataPoints.length <= 300) {
      return sortedDataPoints;
    }

    // Drop the oldest data points (earliest in the array order)
    return sortedDataPoints.slice(-300);
  }
}
