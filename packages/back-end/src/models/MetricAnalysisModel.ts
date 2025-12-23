import {
  MetricAnalysisInterface,
  MetricAnalysisSettings,
} from "shared/types/metric-analysis";
import { metricAnalysisInterfaceValidator } from "shared/validators";
import {
  getCollection,
  removeMongooseFields,
  ToInterface,
} from "../util/mongo.util";
import { MakeModelClass } from "./BaseModel";

const COLLECTION_NAME = "metricanalyses";
const BaseClass = MakeModelClass({
  schema: metricAnalysisInterfaceValidator,
  collectionName: COLLECTION_NAME,
  idPrefix: "metan_",
  auditLog: {
    entity: "metricAnalysis",
    createEvent: "metricAnalysis.create",
    updateEvent: "metricAnalysis.update",
    deleteEvent: "metricAnalysis.delete",
  },
  globallyUniqueIds: false,
  additionalIndexes: [
    {
      fields: {
        organization: 1,
        metric: 1,
        dateCreated: -1,
      },
    },
  ],
});

export const toInterface: ToInterface<MetricAnalysisInterface> = (doc) => {
  const metricAnalysis = removeMongooseFields(doc);
  return metricAnalysis;
};

export class MetricAnalysisModel extends BaseClass {
  protected canRead(doc: MetricAnalysisInterface): boolean {
    const { metric } = this.getForeignRefs(doc);
    return this.context.permissions.canReadMultiProjectResource(
      metric?.projects || [],
    );
  }
  protected canCreate(doc: MetricAnalysisInterface): boolean {
    const { datasource } = this.getForeignRefs(doc);
    return this.context.permissions.canCreateMetricAnalysis({
      projects: datasource?.projects || [],
    });
  }
  protected canUpdate(existing: MetricAnalysisInterface): boolean {
    return this.canCreate(existing);
  }
  protected canDelete(doc: MetricAnalysisInterface): boolean {
    return this.canCreate(doc);
  }

  public async findLatestBySettings(
    metricId: string,
    {
      settings,
      withHistogram = false,
    }: {
      settings: MetricAnalysisSettings;
      withHistogram?: boolean;
    },
  ) {
    // 1. Get all possible matches (ignoring date ranges for now)
    const matches = await this._find(
      {
        metric: metricId,
        source: { $ne: "northstar" },
        "settings.userIdType": settings.userIdType,
        "settings.populationType": settings.populationType,
        "settings.populationId": settings.populationId || undefined,
        "settings.additionalNumeratorFilters":
          settings.additionalNumeratorFilters,
        "settings.additionalDenominatorFilters":
          settings.additionalDenominatorFilters,
      },
      { sort: { dateCreated: -1 }, limit: 10 },
    );

    // 2. Find the analysis that best matches the requested date range
    const bestMatch = matches.reduce(
      (max, current) => {
        const requestedRange =
          settings.endDate.getTime() - settings.startDate.getTime();
        const currentRange =
          current.settings.endDate.getTime() -
          current.settings.startDate.getTime();

        if (!requestedRange || !currentRange) {
          return max;
        }

        // Calculate overlap
        const maxStart = Math.max(
          settings.startDate.getTime(),
          current.settings.startDate.getTime(),
        );
        const minEnd = Math.min(
          settings.endDate.getTime(),
          current.settings.endDate.getTime(),
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

        // Histograms care about both coverage and precision since it uses a single aggregate row
        // Other graphs use the raw date values and can filter client-side, so only care about coverage
        const score = withHistogram ? coverage * precision : coverage;

        return score > max.score ? { analysis: current, score: score } : max;
      },
      { analysis: null, score: 0 },
    );

    // 3. Return if it's a good enough match
    // This is a balance between accurate results and cache hit rates (i.e. query costs)
    if (bestMatch.score >= 0.85) {
      return bestMatch.analysis;
    }

    return null;
  }

  public async findLatestByMetric(metric: string, includeNorthStar?: boolean) {
    const metricAnalyses = await this._find(
      {
        metric,
        ...(!includeNorthStar ? { source: { $ne: "northstar" } } : {}),
      },
      { sort: { dateCreated: -1 }, limit: 1 },
    );
    return metricAnalyses[0] ? metricAnalyses[0] : null;
  }

  public static async findByQueryIds(orgIds: string[], queryIds: string[]) {
    const metricAnalyses = await getCollection(COLLECTION_NAME)
      .find({
        // Query ids are globally unique, this filter is just for index performance
        organization: { $in: orgIds },
        queries: {
          $elemMatch: { query: { $in: queryIds }, status: "running" },
        },
      })
      .toArray();
    return metricAnalyses.map(toInterface);
  }
}
