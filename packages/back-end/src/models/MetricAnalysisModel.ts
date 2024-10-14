import { MetricAnalysisInterface } from "back-end/types/metric-analysis";
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
      metric?.projects || []
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

  public async findLatestByMetric(metric: string, includeNorthStar?: boolean) {
    const metricAnalyses = await this._find(
      {
        metric,
        ...(!includeNorthStar ? { source: { $ne: "northstar" } } : {}),
      },
      { sort: { dateCreated: -1 }, limit: 1 }
    );
    return metricAnalyses[0] ? metricAnalyses[0] : null;
  }
}
