import uniqid from "uniqid";
import { formatISO } from "date-fns";
import { FilterQuery } from "mongoose";
import { isValidDataPoint } from "shared/util";
import { getValidDate } from "shared/dates";
import {
  metricTimeSeriesSchema,
  metricTimeSeriesStripSchema,
  metricTimeSeriesBaseModelSchema,
  MetricTimeSeries,
  CreateMetricTimeSeries,
  CreateMetricTimeSeriesSingleDataPoint,
} from "shared/validators";
import { logger } from "back-end/src/util/logger";
import { MakeModelClass } from "./BaseModel";

// The unique fields for a given MetricTimeSeries
// matches the unique index on BaseClass below
type MetricTimeSeriesUniqueFields = Pick<
  MetricTimeSeries,
  | "source"
  | "sourceId"
  | "sourcePhase"
  | "metricId"
  | "dimensionId"
  | "dimensionValue"
>;

const BaseClass = MakeModelClass({
  schema: metricTimeSeriesBaseModelSchema,
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
        dimensionId: 1,
        dimensionValue: 1,
      },
    },
  ],
  indexesToRemove: [
    "organization_1_source_1_sourceId_1_metricId_1",
    "organization_1_source_1_sourceId_1_sourcePhase_1_metricId_1",
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

  public async getBySourceAndMetricIds({
    source,
    sourceId,
    sourcePhase,
    metricIds,
    dimensions,
  }: {
    source: MetricTimeSeries["source"];
    sourceId: MetricTimeSeries["sourceId"];
    sourcePhase: MetricTimeSeries["sourcePhase"];
    metricIds: Array<MetricTimeSeries["metricId"]>;
    dimensions?: Array<{
      id: string;
      value?: string;
    }>;
  }): Promise<MetricTimeSeries[]> {
    const query = this.getMetricTimeSeriesByMetricIdsQuery({
      source,
      sourceId,
      sourcePhase,
      metricIds,
    });

    if (dimensions && dimensions.length > 0) {
      query.$or = dimensions.map(({ id, value }) =>
        value === undefined
          ? { dimensionId: id }
          : { dimensionId: id, dimensionValue: value },
      );
    } else {
      query.dimensionId = { $in: [null, undefined] };
    }

    const results = await this._find(query);
    return results.map((result) => metricTimeSeriesSchema.parse(result));
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

  private async findExistingForUpsert(
    metricTimeSeriesIdentifiers: MetricTimeSeriesUniqueFields[],
  ): Promise<MetricTimeSeries[]> {
    const groups = new Map<
      string,
      {
        source: MetricTimeSeries["source"];
        sourceId: MetricTimeSeries["sourceId"];
        sourcePhase: MetricTimeSeries["sourcePhase"];
        dimensionId: MetricTimeSeries["dimensionId"];
        dimensionValue: MetricTimeSeries["dimensionValue"];

        // Note: the groups are well-defined by dimension and value, but we can
        // handle multiple metricIds per group
        metricIds: MetricTimeSeries["metricId"][];
      }
    >();

    metricTimeSeriesIdentifiers.forEach((mts) => {
      const groupIdentifier = JSON.stringify([
        mts.source,
        mts.sourceId,
        mts.sourcePhase,
        mts.dimensionId,
        mts.dimensionValue,
      ]);

      const group = groups.get(groupIdentifier);
      if (group) {
        group.metricIds.push(mts.metricId);
      } else {
        groups.set(groupIdentifier, {
          source: mts.source,
          sourceId: mts.sourceId,
          sourcePhase: mts.sourcePhase,
          dimensionId: mts.dimensionId,
          dimensionValue: mts.dimensionValue,
          metricIds: [mts.metricId],
        });
      }
    });

    const allPromises = Array.from(groups.values()).map(
      ({
        source,
        sourceId,
        sourcePhase,
        dimensionId,
        dimensionValue,
        metricIds,
      }) =>
        this._find(
          this.getMetricTimeSeriesUpsertQuery({
            source,
            sourceId,
            sourcePhase,
            dimensionId,
            dimensionValue,
            metricIds,
          }),
        ),
    );

    const allResults = await Promise.all(allPromises);
    return allResults
      .flat()
      .map((result) => metricTimeSeriesSchema.parse(result));
  }

  private getMetricTimeSeriesUpsertQuery({
    source,
    sourceId,
    sourcePhase,
    dimensionId,
    dimensionValue,
    metricIds,
  }: Omit<MetricTimeSeriesUniqueFields, "metricId"> & {
    metricIds: MetricTimeSeriesUniqueFields["metricId"][];
  }): FilterQuery<MetricTimeSeries> {
    return {
      ...this.getMetricTimeSeriesByMetricIdsQuery({
        source,
        sourceId,
        sourcePhase,
        metricIds,
      }),

      // Match absent/null for main series, exact value for dimension series.
      dimensionId:
        dimensionId === undefined ? { $in: [null, undefined] } : dimensionId,
      dimensionValue:
        dimensionValue === undefined
          ? { $in: [null, undefined] }
          : dimensionValue,
    };
  }

  private getMetricTimeSeriesByMetricIdsQuery({
    source,
    sourceId,
    sourcePhase,
    metricIds,
  }: Omit<MetricTimeSeriesUniqueFields, "metricId"> & {
    metricIds: MetricTimeSeriesUniqueFields["metricId"][];
  }): FilterQuery<MetricTimeSeries> {
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
        query.sourcePhase = { $exists: true, $ne: null };
      }
    } else {
      query.sourcePhase = sourcePhase;
    }

    return query;
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
    const existingMetricTimeSeries =
      await this.findExistingForUpsert(metricTimeSeries);
    const existingByKey = new Map(
      existingMetricTimeSeries.map((series) => [
        JSON.stringify([
          series.source,
          series.sourceId,
          series.sourcePhase ?? null,
          series.metricId,
          series.dimensionId ?? null,
          series.dimensionValue ?? null,
        ]),
        series,
      ]),
    );

    const toCreate: CreateMetricTimeSeries[] = [];
    const toUpdate: MetricTimeSeries[] = [];

    metricTimeSeries.forEach((mts) => {
      const existing = existingByKey.get(
        JSON.stringify([
          mts.source,
          mts.sourceId,
          mts.sourcePhase ?? null,
          mts.metricId,
          mts.dimensionId ?? null,
          mts.dimensionValue ?? null,
        ]),
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

    return metricTimeSeriesStripSchema.parse({
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
      logger.warn(
        {
          newTimeSeries,
        },
        "Invalid data point. Skipping creation of time series.",
      );
      return;
    }

    return metricTimeSeriesStripSchema.parse({
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
