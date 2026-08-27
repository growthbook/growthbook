import {
  ApiInterleavingInterface,
  InterleavingInterface,
  interleavingValidator,
  INTERLEAVING_INTERLEAVE_ID_COLUMN,
  INTERLEAVING_ITEM_ID_COLUMN,
} from "shared/validators";
import { isFactMetricId } from "shared/experiments";
import { MakeModelClass } from "back-end/src/models/BaseModel";
import { getFactTable } from "back-end/src/models/FactTableModel";
import { interleavingApiSpec } from "back-end/src/api/specs/interleaving.spec";

const BaseClass = MakeModelClass({
  schema: interleavingValidator,
  collectionName: "interleavings",
  idPrefix: "il_",
  globallyUniquePrimaryKeys: true,
  defaultValues: {
    owner: "",
    tags: [],
    archived: false,
    status: "draft",
    metrics: [],
  },
  auditLog: {
    entity: "interleaving",
    createEvent: "interleaving.create",
    updateEvent: "interleaving.update",
    deleteEvent: "interleaving.delete",
  },
  apiConfig: {
    modelKey: "interleavings",
    openApiSpec: interleavingApiSpec,
  },
});

export class InterleavingModel extends BaseClass {
  protected canRead(doc: InterleavingInterface): boolean {
    return this.context.permissions.canReadSingleProjectResource(doc.project);
  }
  protected canCreate(doc: InterleavingInterface): boolean {
    return this.context.permissions.canCreateInterleaving(doc);
  }
  protected canUpdate(
    existing: InterleavingInterface,
    updates: Partial<InterleavingInterface>,
  ): boolean {
    return this.context.permissions.canUpdateInterleaving(existing, updates);
  }
  protected canDelete(doc: InterleavingInterface): boolean {
    return this.context.permissions.canDeleteInterleaving(doc);
  }

  protected hasPremiumFeature(): boolean {
    return this.context.hasPremiumFeature("interleaving");
  }

  protected async customValidation(
    doc: InterleavingInterface,
    previousDoc?: InterleavingInterface,
  ): Promise<void> {
    const query = await this.context.models.interleavingQueries.getById(
      doc.interleavingQueryId,
    );
    if (!query) {
      throw new Error(
        `Interleaving query not found: ${doc.interleavingQueryId}`,
      );
    }
    if (query.datasourceId !== doc.datasource) {
      throw new Error(
        `Interleaving query ${doc.interleavingQueryId} must belong to datasource ${doc.datasource}`,
      );
    }

    // Only re-validate metrics when they (or the datasource) change so an
    // interleaving whose metric was deleted after the fact can still be updated
    const metricsChanged =
      !previousDoc ||
      doc.datasource !== previousDoc.datasource ||
      JSON.stringify(doc.metrics) !== JSON.stringify(previousDoc.metrics);
    if (!metricsChanged) return;

    for (const { id: metricId, estimator } of doc.metrics) {
      if (!isFactMetricId(metricId)) {
        throw new Error(
          `Interleaving metrics must be fact metrics: ${metricId}`,
        );
      }
      const metric = await this.context.models.factMetrics.getById(metricId);
      if (!metric) {
        throw new Error(`Interleaving metric not found: ${metricId}`);
      }
      if (metric.datasource !== doc.datasource) {
        throw new Error(
          `Interleaving metric ${metricId} must belong to datasource ${doc.datasource}`,
        );
      }
      if (metric.metricType !== "mean" && metric.metricType !== "proportion") {
        throw new Error(
          `Interleaving metrics must be mean or proportion metrics: ${metricId} is a ${metric.metricType} metric`,
        );
      }
      const factTableId = metric.numerator?.factTableId;
      const factTable = factTableId
        ? await getFactTable(this.context, factTableId)
        : null;
      if (!factTable) {
        throw new Error(
          `Fact table not found for interleaving metric ${metricId}`,
        );
      }
      const itemIdColumn = factTable.columns.find(
        (c) => c.column === INTERLEAVING_ITEM_ID_COLUMN && !c.deleted,
      );
      if (!itemIdColumn) {
        throw new Error(
          `Interleaving metric ${metricId} requires an '${INTERLEAVING_ITEM_ID_COLUMN}' column on its fact table (${factTable.name}) so engagement can be attributed to items`,
        );
      }
      if (itemIdColumn.isVirtual) {
        throw new Error(
          `The '${INTERLEAVING_ITEM_ID_COLUMN}' column on fact table ${factTable.name} must be a physical column, not a virtual one`,
        );
      }
      if (estimator === "paired") {
        const interleaveIdColumn = factTable.columns.find(
          (c) => c.column === INTERLEAVING_INTERLEAVE_ID_COLUMN && !c.deleted,
        );
        if (!interleaveIdColumn) {
          throw new Error(
            `Metric ${metricId} cannot use the paired analysis: its fact table (${factTable.name}) has no '${INTERLEAVING_INTERLEAVE_ID_COLUMN}' column. Use the ownership analysis instead`,
          );
        }
      }
    }
  }

  protected toApiInterface(
    doc: InterleavingInterface,
  ): ApiInterleavingInterface {
    return {
      id: doc.id,
      dateCreated: doc.dateCreated.toISOString(),
      dateUpdated: doc.dateUpdated.toISOString(),
      name: doc.name,
      description: doc.description,
      project: doc.project,
      owner: doc.owner,
      tags: doc.tags,
      archived: doc.archived,
      status: doc.status,
      dateStarted: doc.dateStarted?.toISOString(),
      dateStopped: doc.dateStopped?.toISOString(),
      trackingKey: doc.trackingKey,
      datasource: doc.datasource,
      interleavingQueryId: doc.interleavingQueryId,
      variationNames: doc.variationNames,
      metrics: doc.metrics,
    };
  }

  /** All interleaving experiments referencing an interleaving query. */
  public getByInterleavingQueryId(
    interleavingQueryId: string,
  ): Promise<InterleavingInterface[]> {
    return this._find({ interleavingQueryId });
  }
}
