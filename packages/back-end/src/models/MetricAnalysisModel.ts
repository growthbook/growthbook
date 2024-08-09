import { MetricAnalysisInterface } from "@back-end/types/metric-analysis";
import { metricAnalysisInterfaceValidator } from "../routers/metric-analysis/metric-analysis.validators";
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
});

export class MetricAnalysisModel extends BaseClass {
  protected canRead(doc: MetricAnalysisInterface): boolean {
    const { metric } = this.getForeignRefs(doc);
    return this.context.hasPermission("readData", metric?.projects || []);
  }
  protected canCreate(doc: MetricAnalysisInterface): boolean {
    const { metric } = this.getForeignRefs(doc);
    return this.context.permissions.canRunMetricQueries({
      projects: metric?.projects || [],
    });
  }
  protected canUpdate(existing: MetricAnalysisInterface): boolean {
    return this.canCreate(existing);
  }
  protected canDelete(doc: MetricAnalysisInterface): boolean {
    return this.canCreate(doc);
  }

  public async findLatestByMetric(metric: string) {
    const metricAnalyses = await this._find(
      { metric },
      { sort: { dateCreated: -1 }, limit: 1 }
    );
    return metricAnalyses[0] ? metricAnalyses[0] : null;
  }
}
