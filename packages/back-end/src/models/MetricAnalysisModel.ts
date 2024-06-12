import { DEFAULT_PROPER_PRIOR_STDDEV } from "shared/constants";
import { MetricAnalysisInterface } from "@back-end/types/metric-analysis";
import { metricAnalysisInterfaceValidator } from "../routers/metric-analysis/metric-analysis.validators";
import {
  FactMetricInterface,
  LegacyFactMetricInterface,
} from "../../types/fact-table";
import { DEFAULT_CONVERSION_WINDOW_HOURS } from "../util/secrets";
import { UpdateProps } from "../../types/models";
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
  protected canUpdate(
    existing: MetricAnalysisInterface,
    updates: UpdateProps<MetricAnalysisInterface>
  ): boolean {
    return this.canCreate(existing);
  }
  protected canDelete(doc: MetricAnalysisInterface): boolean {
    return false;
  }

  public async findLatestByMetric(metric: string) {
    const metricAnalyses = await this._find({ metric }, { sort: { dateCreated: -1 }, limit: 1 });
    return metricAnalyses[0] ? metricAnalyses[0] : null;
  }

  //public toApiInterface(factMetric: FactMetricInterface): ApiFactMetric {
}
