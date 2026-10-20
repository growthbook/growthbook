import {
  MetricAnalysisInterface,
  MetricAnalysisSettings,
} from "shared/types/metric-analysis";
import {
  ApiMetricAnalysisReturn,
  metricAnalysisInterfaceValidator,
} from "shared/validators";
import {
  getCollection,
  removeMongooseFields,
  ToInterface,
} from "back-end/src/util/mongo.util";
import { defineCustomApiHandler } from "back-end/src/api/apiModelHandlers";
import {
  cancelMetricAnalysisEndpoint,
  getMetricAnalysisEndpoint,
  metricAnalysisApiSpec,
} from "back-end/src/api/specs/metric-analysis.spec";
import { MetricAnalysisQueryRunner } from "back-end/src/queryRunners/MetricAnalysisQueryRunner";
import { getIntegrationFromDatasourceId } from "back-end/src/services/datasource";
import { NotFoundError } from "back-end/src/util/errors";
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
  globallyUniquePrimaryKeys: false,
  additionalIndexes: [
    {
      fields: {
        organization: 1,
        metric: 1,
        dateCreated: -1,
      },
    },
  ],
  apiConfig: {
    modelKey: "metricAnalysis",
    openApiSpec: metricAnalysisApiSpec,
    customHandlers: [
      defineCustomApiHandler({
        ...getMetricAnalysisEndpoint,
        reqHandler: async (req): Promise<ApiMetricAnalysisReturn> => {
          const model = req.context.models.metricAnalysis;
          return {
            metricAnalysis: model.toApiInterface(
              await model.findOrThrow(req.params.id),
            ),
          };
        },
      }),
      defineCustomApiHandler({
        ...cancelMetricAnalysisEndpoint,
        reqHandler: (req): Promise<ApiMetricAnalysisReturn> =>
          req.context.models.metricAnalysis.apiCancel(req.params.id),
      }),
    ],
  },
});

export const toInterface: ToInterface<MetricAnalysisInterface> = (doc) => {
  const metricAnalysis = removeMongooseFields(doc);
  return metricAnalysis;
};

export class MetricAnalysisModel extends BaseClass {
  public toApiInterface(a: MetricAnalysisInterface) {
    const { result } = a;
    return {
      id: a.id,
      metric: a.metric,
      status: a.status,
      error: a.error,
      settings: {
        ...a.settings,
        startDate: a.settings.startDate.toISOString(),
        endDate: a.settings.endDate.toISOString(),
      },
      ...(result
        ? {
            result: {
              ...result,
              dates: result.dates?.map((d) => ({
                ...d,
                date: d.date.toISOString(),
              })),
            },
          }
        : {}),
      dateCreated: a.dateCreated.toISOString(),
      dateUpdated: a.dateUpdated.toISOString(),
    };
  }

  public async findOrThrow(id: string) {
    const analysis = await this.getById(id);
    if (!analysis) {
      throw new NotFoundError(`Could not find metric analysis ${id}.`);
    }
    return analysis;
  }

  public async apiCancel(id: string): Promise<ApiMetricAnalysisReturn> {
    const analysis = await this.findOrThrow(id);
    const metric = await this.context.models.factMetrics.getById(
      analysis.metric,
    );
    if (!metric?.datasource) {
      throw new NotFoundError(
        "Could not find the Data Source for this Fact Metric.",
      );
    }
    const integration = await getIntegrationFromDatasourceId(
      this.context,
      metric.datasource,
    );
    if (!this.context.permissions.canRunMetricQueries(integration.datasource)) {
      this.context.permissions.throwPermissionError();
    }
    await new MetricAnalysisQueryRunner(
      this.context,
      analysis,
      integration,
    ).cancelQueries();
    return {
      metricAnalysis: this.toApiInterface(await this.findOrThrow(analysis.id)),
    };
  }

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
    type ReduceAcc = {
      analysis: MetricAnalysisInterface | null;
      score: number;
    };
    const bestMatch = matches.reduce<ReduceAcc>(
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
