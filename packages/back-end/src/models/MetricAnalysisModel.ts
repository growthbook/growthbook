import {
  MetricAnalysisInterface,
  MetricAnalysisSettings,
} from "back-end/types/metric-analysis";
import { metricAnalysisInterfaceValidator } from "back-end/src/routers/metric-analysis/metric-analysis.validators";
import { MakeModelClass } from "./BaseModel";

const BaseClass = MakeModelClass({
  schema: metricAnalysisInterfaceValidator,
  collectionName: "metricanalyses",
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
    settings: MetricAnalysisSettings,
  ) {
    // 1. Get all possible matches (ignoring date ranges for now)
    const matches = await this._find(
      {
        metric: metricId,
        "settings.userIdType": settings.userIdType,
        "settings.populationType": settings.populationType,
        "settings.populationId": settings.populationId,
      },
      { sort: { dateCreated: -1 }, limit: 10 },
    );

    // 2. Find the analysis that covers the most of the requested date range
    const maxOverlapAnalysis = matches.reduce(
      (max, current) => {
        const maxStart = Math.max(
          settings.startDate.getTime(),
          current.settings.startDate.getTime(),
        );
        const minEnd = Math.min(
          settings.endDate.getTime(),
          current.settings.endDate.getTime(),
        );
        const currentOverlap =
          Math.max(0, minEnd - maxStart) /
          (settings.endDate.getTime() - settings.startDate.getTime());

        return currentOverlap > max.overlap
          ? { analysis: current, overlap: currentOverlap }
          : max;
      },
      { analysis: null, overlap: 0 },
    );

    // 3. Return if at least 75% of the requested date range is covered
    if (maxOverlapAnalysis.overlap >= 0.75) {
      return maxOverlapAnalysis.analysis;
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
}
