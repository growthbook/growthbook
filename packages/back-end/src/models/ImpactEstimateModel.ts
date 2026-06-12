import { getMetricWindowHours } from "shared/experiments";
import { SegmentInterface } from "shared/types/segment";
import { ImpactEstimateInterface } from "shared/types/impact-estimate";
import { impactEstimateValidator } from "shared/validators";
import { getMetricById } from "back-end/src/models/MetricModel";
import { getIntegrationFromDatasourceId } from "back-end/src/services/datasource";
import { DEFAULT_CONVERSION_WINDOW_HOURS } from "back-end/src/util/secrets";
import { processMetricValueQueryResponse } from "back-end/src/queryRunners/LegacyMetricAnalysisQueryRunner";
import { getFactTableMap } from "./FactTableModel";
import { MakeModelClass } from "./BaseModel";

const BaseClass = MakeModelClass({
  schema: impactEstimateValidator,
  collectionName: "impactestimates",
  idPrefix: "est_",
  globallyUniquePrimaryKeys: false,
  defaultValues: {
    query: "",
    queryLanguage: "none",
  },
});

export class ImpactEstimateModel extends BaseClass {
  protected canRead(doc: ImpactEstimateInterface): boolean {
    const { metric } = this.getForeignRefs(doc, false);
    return this.context.permissions.canReadMultiProjectResource(
      metric?.projects || [],
    );
  }

  protected canCreate(doc: ImpactEstimateInterface): boolean {
    // The doc has no datasource field, so scope the check to the referenced
    // metric's projects (same scoping canRead uses)
    const { metric } = this.getForeignRefs(doc);
    return this.context.permissions.canCreateMetricAnalysis({
      projects: metric?.projects || [],
    });
  }

  protected canUpdate(existing: ImpactEstimateInterface): boolean {
    return this.canCreate(existing);
  }

  protected canDelete(doc: ImpactEstimateInterface): boolean {
    return this.canCreate(doc);
  }

  public async getImpactEstimate(
    metric: string,
    numDays: number,
    segment?: string,
  ): Promise<ImpactEstimateInterface | null> {
    const { context } = this;

    const metricObj = await getMetricById(context, metric);
    if (!metricObj) {
      throw new Error("Metric not found");
    }

    if (!metricObj.datasource) {
      return null;
    }

    const integration = await getIntegrationFromDatasourceId(
      context,
      metricObj.datasource,
      true,
    );

    if (!context.permissions.canRunMetricQueries(integration.datasource)) {
      context.permissions.throwPermissionError();
    }

    let segmentObj: SegmentInterface | null = null;
    if (segment) {
      segmentObj = await context.models.segments.getById(segment);
    }

    if (segmentObj?.datasource !== metricObj.datasource) {
      segmentObj = null;
    }

    const factTableMap = await getFactTableMap(context);

    const conversionWindowHours =
      getMetricWindowHours(metricObj.windowSettings) ||
      DEFAULT_CONVERSION_WINDOW_HOURS;

    // Ignore last X hours of data since we need to give people time to convert
    const end = new Date();
    end.setHours(end.getHours() - conversionWindowHours);
    const start = new Date();
    start.setDate(start.getDate() - numDays);
    start.setHours(start.getHours() - conversionWindowHours);

    const query = integration.getMetricValueQuery({
      from: start,
      to: end,
      name: "Metric Value",
      metric: metricObj,
      includeByDate: true,
      segment: segmentObj || undefined,
      factTableMap,
    });

    const queryResponse = await integration.runMetricValueQuery(
      query,
      // We're not storing a query in Mongo for this, so we don't support cancelling here
      async () => {
        // Ignore calls to setExternalId
      },
    );
    const value = processMetricValueQueryResponse(queryResponse.rows);

    let daysWithData = numDays;
    if (value.dates && value.dates.length > 0) {
      daysWithData = value.dates.length;
    }

    const conversionsPerDay = value.count / daysWithData;

    return this.create({
      metric,
      segment: segment || undefined,
      conversionsPerDay,
      query,
      queryLanguage: integration.getSourceProperties().queryLanguage,
    });
  }

  public getByMetric(metricId: string): Promise<ImpactEstimateInterface[]> {
    return this._find({ metric: metricId });
  }

  // Cross-model cleanup when a metric is deleted. Clears the metric reference
  // on any estimates pointing at it, mirroring the legacy updateMany behavior.
  public async clearMetric(metricId: string): Promise<void> {
    await this._dangerousGetCollection().updateMany(
      { organization: this.context.org.id, metric: metricId },
      { $set: { metric: "", dateUpdated: new Date() } },
    );
  }
}
