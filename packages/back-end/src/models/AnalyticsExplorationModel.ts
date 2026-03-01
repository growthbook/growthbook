import {
  ProductAnalyticsConfig,
  ProductAnalyticsExploration,
  productAnalyticsExplorationValidator,
} from "shared/validators";
import md5 from "md5";
import {
  calculateProductAnalyticsDateRange,
  getDateGranularity,
} from "shared/enterprise";
import { getValidDate } from "shared/dates";
import { MakeModelClass } from "./BaseModel";

const COLLECTION_NAME = "analyticsexploration";
const BaseClass = MakeModelClass({
  schema: productAnalyticsExplorationValidator,
  collectionName: COLLECTION_NAME,
  idPrefix: "ae_",
  globallyUniqueIds: false,
  additionalIndexes: [],
});

export class AnalyticsExplorationModel extends BaseClass {
  public getConfigHashes(config: ProductAnalyticsConfig) {
    const dataset = config.dataset;
    if (!dataset) return null;

    const dateRange = calculateProductAnalyticsDateRange(config.dateRange);

    const dimensions = config.dimensions.map((dimension) => {
      if (dimension.dimensionType === "date") {
        // Evaluate "auto" granularity for higher cache hit rates
        return {
          ...dimension,
          dateGranularity: getDateGranularity(
            dimension.dateGranularity,
            dateRange,
          ),
        };
      }
      return dimension;
    });

    // General settings hash
    const generalSettingsHash = md5(
      JSON.stringify({
        datasetType: dataset.type,
        datasource: config.datasource,
        dimensions: dimensions,
        factTableId: dataset.type === "fact_table" ? dataset.factTableId : null,
        table: dataset.type === "data_source" ? dataset.table : null,
        path: dataset.type === "data_source" ? dataset.path : null,
        timestampColumn:
          dataset.type === "data_source" ? dataset.timestampColumn : null,
      }),
    );

    // Value hashes
    const valueHashes = dataset.values.map((value) => {
      // Ignore disabled filters
      const rowFilters = value.rowFilters
        ?.filter((filter) => !filter.disabled)
        .map((f) => ({ ...f, disabled: undefined }));

      return md5(
        JSON.stringify({
          ...value,
          rowFilters: rowFilters,
        }),
      );
    });

    return {
      generalSettingsHash,
      valueHashes,
    };
  }

  protected canRead(doc: ProductAnalyticsExploration): boolean {
    const { datasource } = this.getForeignRefs(doc);
    return this.context.permissions.canReadMultiProjectResource(
      datasource?.projects || [],
    );
  }
  protected canCreate(doc: ProductAnalyticsExploration): boolean {
    const { datasource } = this.getForeignRefs(doc);
    if (!datasource) return false;
    return this.context.permissions.canRunTestQueries(datasource);
  }
  protected canUpdate(existing: ProductAnalyticsExploration): boolean {
    return this.canCreate(existing);
  }
  protected canDelete(doc: ProductAnalyticsExploration): boolean {
    return this.canCreate(doc);
  }

  public async findLatestByConfig(config: ProductAnalyticsConfig) {
    const { dataset } = config;
    if (!dataset) return null;

    const configHashes = this.getConfigHashes(config);
    if (!configHashes) return null;

    // 1. Get all possible matches (ignoring date ranges for now)
    const matches = await this._find(
      {
        datasource: config.datasource,
        status: "success",
        configHash: configHashes.generalSettingsHash,
        valueHashes: { $eq: configHashes.valueHashes },
      },
      { sort: { dateCreated: -1 }, limit: 5 },
    );

    const requestedDates = calculateProductAnalyticsDateRange(config.dateRange);

    // 2. Find the analysis that best matches the requested date range
    const bestMatch = matches.reduce(
      (max, current) => {
        const requestedRange =
          requestedDates.endDate.getTime() - requestedDates.startDate.getTime();
        const currentRange =
          getValidDate(current.dateEnd).getTime() -
          getValidDate(current.dateStart).getTime();

        if (!requestedRange || !currentRange) {
          return max;
        }

        // Calculate overlap
        const maxStart = Math.max(
          requestedDates.startDate.getTime(),
          getValidDate(current.dateStart).getTime(),
        );
        const minEnd = Math.min(
          requestedDates.endDate.getTime(),
          getValidDate(current.dateEnd).getTime(),
        );
        const overlap = Math.max(0, minEnd - maxStart);

        // Calculate coverage
        // 1 = full coverage of requested date range, 0 = no coverage
        const coverage = overlap / requestedRange;

        // Calculate precision
        // 1 = no extra data outside of requested range, 0 = more data outside than inside requested range
        const precision = Math.max(
          0,
          1 - (currentRange - overlap) / requestedRange,
        );

        const score = coverage * precision;

        return score > max.score ? { analysis: current, score: score } : max;
      },
      { analysis: null, score: 0 } as {
        analysis: ProductAnalyticsExploration | null;
        score: number;
      },
    );

    // 3. Return if it's a good enough match
    // This is a balance between accurate results and cache hit rates (i.e. query costs)
    if (bestMatch.score >= 0.9) {
      return bestMatch.analysis;
    }

    return null;
  }

  protected async beforeCreate(
    doc: ProductAnalyticsExploration,
  ): Promise<void> {
    const configHashes = this.getConfigHashes(doc.config);
    if (!configHashes) return;
    doc.configHash = configHashes.generalSettingsHash;
    doc.valueHashes = configHashes.valueHashes;
  }
}
