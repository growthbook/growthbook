import uniqid from "uniqid";
import { formatISO } from "date-fns";
import { FilterQuery } from "mongoose";
import { isValidDataPoint } from "shared/util";
import { getValidDate } from "shared/dates";
import {
  metricTimeSeriesSchema,
  MetricTimeSeries,
  CreateMetricTimeSeries,
  CreateMetricTimeSeriesSingleDataPoint,
} from "shared/validators";
import { logger } from "back-end/src/util/logger";
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
        sourcePhase: 1,
        metricId: 1,
      },
    },
  ],
  indexesToRemove: ["organization_1_source_1_sourceId_1_metricId_1"],
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

  public async getBySourceAndMetricIds({
    source,
    sourceId,
    sourcePhase,
    metricIds,
  }: {
    source: MetricTimeSeries["source"];
    sourceId: MetricTimeSeries["sourceId"];
    sourcePhase: MetricTimeSeries["sourcePhase"];
    metricIds: Array<MetricTimeSeries["metricId"]>;
  }): Promise<MetricTimeSeries[]> {
    const query: FilterQuery<MetricTimeSeries> = {
      source,
      sourceId,
      metricId: { $in: metricIds },
    };

    // For experiments, ensure sourcePhase is always defined.
    if (source === "experiment") {
      if (sourcePhase !== undefined) {
        query.sourcePhase = sourcePhase;
      } else {
        // If sourcePhase is undefined for an experiment, ensure we only get records with defined sourcePhase
        query.sourcePhase = { $exists: true, $ne: null };
      }
    } else {
      query.sourcePhase = sourcePhase;
    }

    const results = await this._find(query);

    return results;
  }

  public async deleteAllBySource(
    source: MetricTimeSeries["source"],
    sourceId: MetricTimeSeries["sourceId"],
  ) {
    await this._dangerousGetCollection().deleteMany({
      organization: this.context.org.id,
      source,
      sourceId,
    });
  }

  public async findMany(
    metricTimeSeriesIdentifiers: Pick<
      MetricTimeSeries,
      "source" | "sourceId" | "sourcePhase" | "metricId"
    >[],
  ) {
    const metricTimeSeriesPerSource = new Map<
      string,
      {
        source: MetricTimeSeries["source"];
        sourceId: MetricTimeSeries["sourceId"];
        sourcePhase: MetricTimeSeries["sourcePhase"];
        metricIds: MetricTimeSeries["metricId"][];
      }
    >();

    metricTimeSeriesIdentifiers.forEach((mts) => {
      const sourceIdentifier = `${mts.source}::${mts.sourceId}::${mts.sourcePhase}`;
      if (!metricTimeSeriesPerSource.has(sourceIdentifier)) {
        metricTimeSeriesPerSource.set(sourceIdentifier, {
          source: mts.source,
          sourceId: mts.sourceId,
          sourcePhase: mts.sourcePhase,
          metricIds: [mts.metricId],
        });
      } else {
        metricTimeSeriesPerSource
          .get(sourceIdentifier)!
          .metricIds.push(mts.metricId);
      }
    });

    const allPromises = Array.from(metricTimeSeriesPerSource.values()).map(
      ({ source, sourceId, sourcePhase, metricIds }) =>
        this.getBySourceAndMetricIds({
          source,
          sourceId,
          sourcePhase,
          metricIds,
        }),
    );

    const allResults = await Promise.all(allPromises);

    return allResults.flat();
  }

  /**
   * Based on the provided identifiers (source, sourceId, sourcePhase, metricId), this function will:
   * - If a record does not exist, it will be created.
   * - If a record exists, the provided data point will be added to the end of the dataPoints array.
   *
   * @param metricTimeSeries - An array of metric time series identifiers and data points to upsert.
   */
  public async upsertMultipleSingleDataPoint(
    metricTimeSeries: CreateMetricTimeSeriesSingleDataPoint[],
  ) {
    const existingMetricTimeSeries = await this.findMany(metricTimeSeries);

    const toCreate: CreateMetricTimeSeries[] = [];
    const toUpdate: MetricTimeSeries[] = [];

    metricTimeSeries.forEach((mts) => {
      const existing = existingMetricTimeSeries.find(
        (existing) =>
          existing.source === mts.source &&
          existing.sourceId === mts.sourceId &&
          existing.sourcePhase === mts.sourcePhase &&
          existing.metricId === mts.metricId,
      );

      if (existing) {
        toUpdate.push(this.getUpdatedMetricTimeSeries(existing, mts));
      } else {
        const newTimeSeries = this.getNewMetricTimeSeries(mts);
        if (newTimeSeries) {
          toCreate.push(newTimeSeries);
        }
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
        { ignoreUndefined: true },
      );
    }
  }

  private getUpdatedMetricTimeSeries(
    existing: MetricTimeSeries,
    newTimeSeries: CreateMetricTimeSeriesSingleDataPoint,
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

    const dataPoints = this.dropInvalidAndLimitDataPoints([
      ...existing.dataPoints,
      newTimeSeries.singleDataPoint,
    ]);

    if (dataPoints.length === 0) {
      logger.warn(
        {
          metricTimeSeriesId: existing.id,
          newDataPoint: newTimeSeries.singleDataPoint,
        },
        "No valid data points for metric time series. Skipping update.",
      );
      return existing;
    }

    return metricTimeSeriesSchema.strip().parse({
      ...existing,
      lastMetricSettingsHash: newTimeSeries.lastMetricSettingsHash,
      lastExperimentSettingsHash: newTimeSeries.lastExperimentSettingsHash,
      dataPoints,
      dateUpdated: new Date(),
    });
  }

  private getNewMetricTimeSeries(
    newTimeSeries: CreateMetricTimeSeriesSingleDataPoint,
  ): MetricTimeSeries | undefined {
    if (!isValidDataPoint(newTimeSeries.singleDataPoint)) {
      // logger.warn(
      //   {
      //     newTimeSeries,
      //   },
      //   "Invalid data point. Skipping creation of time series.",
      // );
      return;
    }

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
   * Drops invalid data points.
   * Keeps the most recent data point per day, if it is not tagged.
   * Keeps all data points that are tagged & valid.
   * Limits the total to 300 most recent points.
   */
  private dropInvalidAndLimitDataPoints(
    dataPoints: MetricTimeSeries["dataPoints"],
  ) {
    const lastDataPointPerDay = dataPoints
      .sort(
        (a, b) =>
          getValidDate(a.date).getTime() - getValidDate(b.date).getTime(),
      )
      .reduceRight((acc, dataPoint) => {
        if (!isValidDataPoint(dataPoint)) {
          return acc;
        }

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
