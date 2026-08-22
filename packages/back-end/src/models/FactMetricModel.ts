import { FilterQuery } from "mongoose";
import { omit } from "lodash";
import {
  DEFAULT_PROPER_PRIOR_STDDEV,
  DEFAULT_TARGET_MDE,
} from "shared/constants";
import {
  getAggregateFilters,
  getSelectedColumnDatatype,
  isFactFunnelMetric,
} from "shared/experiments";
import { UpdateProps } from "shared/types/base-model";
import { factMetricValidator, ApiFactMetric } from "shared/validators";
import {
  ColumnRef,
  FactMetricInterface,
  FactMetricType,
  FactTableInterface,
  FunnelFactMetricInterface,
  LegacyColumnRef,
  LegacyFactMetricInterface,
  StandardFactMetricInterface,
} from "shared/types/fact-table";
import { DEFAULT_CONVERSION_WINDOW_HOURS } from "back-end/src/util/secrets";
import { promiseAllChunks } from "back-end/src/util/promise";
import { getSourceIntegrationObject } from "back-end/src/services/datasource";
import {
  getNetNewSqlExprRowFilters,
  validateFactMetricRowFilterSql,
} from "back-end/src/services/factMetricRowFilterValidation";
import { projectFilterQuery } from "back-end/src/util/mongo.util";
import { validateAggregationSpecification } from "back-end/src/services/factMetricAggregationValidation";
import { healPriorSettings } from "back-end/src/util/priors";
import { Context, MakeModelClass } from "./BaseModel";
import { getDataSourceById } from "./DataSourceModel";
import { getFactTableMap } from "./FactTableModel";

const BaseClass = MakeModelClass({
  schema: factMetricValidator,
  collectionName: "factmetrics",
  affectsDefinitionsVersion: true,
  definitionsVersionProjectField: "projects",
  idPrefix: "fact__",
  auditLog: {
    entity: "metric",
    createEvent: "metric.create",
    updateEvent: "metric.update",
    deleteEvent: "metric.delete",
  },
  globallyUniquePrimaryKeys: false,
  readonlyFields: ["datasource"],
  defaultValues: {
    owner: "",
    tags: [],
  },
  // Compound indexes for API list filtering
  additionalIndexes: [
    { fields: { organization: 1, datasource: 1 } },
    { fields: { organization: 1, "numerator.factTableId": 1 } },
    { fields: { organization: 1, "funnelSettings.steps.factTableId": 1 } },
  ],
});

// extra checks on user filter
function validateUserFilter({
  metricType,
  numerator,
  factTable,
}: {
  metricType: FactMetricType;
  numerator: ColumnRef;
  factTable: FactTableInterface;
}): void {
  // error if one is specified but not the other
  if (!!numerator.aggregateFilter !== !!numerator.aggregateFilterColumn) {
    throw new Error(
      `Must specify both "aggregateFilter" and "aggregateFilterColumn" or neither.`,
    );
  }

  // error if metric type is not retention, proportion, or ratio
  if (
    metricType !== "retention" &&
    metricType !== "proportion" &&
    metricType !== "ratio"
  ) {
    throw new Error(
      `Aggregate filter is only supported for retention, proportion, and ratio metrics.`,
    );
  }

  if (numerator.aggregateFilterColumn) {
    // error if column is not numeric or $$count
    const columnType = getSelectedColumnDatatype({
      factTable,
      column: numerator.aggregateFilterColumn,
    });
    if (
      !(
        columnType === "number" || numerator.aggregateFilterColumn === "$$count"
      )
    ) {
      throw new Error(
        `Aggregate filter column '${numerator.aggregateFilterColumn}' must be a numeric column or "$$count".`,
      );
    }

    // error if filter is not valid
    getAggregateFilters({
      columnRef: numerator,
      column: numerator.aggregateFilterColumn,
      ignoreInvalid: false,
    });
  }
}

// Existence is not checked: the replaced metric is often deleted later, and
// failing validation then would make the surviving metric un-editable.
function validateReplaces({ id, replaces }: FactMetricInterface): void {
  if (!replaces?.length) return;

  if (replaces.includes(id)) {
    throw new Error("A metric cannot replace itself");
  }
}

function denominatorRequiredByMetricType(metricType: FactMetricType): boolean {
  switch (metricType) {
    case "mean":
    case "dailyParticipation":
    case "quantile":
    case "retention":
    case "proportion":
    case "funnel":
      return false;
    case "ratio":
      return true;
  }
}

function validateSavedFilterIds({
  columnRef,
  factTable,
  filterType,
}: {
  columnRef: ColumnRef;
  factTable: FactTableInterface;
  filterType: "numerator" | "denominator";
}): void {
  if (!columnRef.rowFilters?.length) return;

  for (const filter of columnRef.rowFilters) {
    const filterId = filter.values?.[0];
    if (
      filter.operator === "saved_filter" &&
      filterId &&
      !factTable.filters.some((f) => f.id === filterId)
    ) {
      throw new Error(`Invalid ${filterType} filter id: ${filterId}`);
    }
  }
}

export class FactMetricModel extends BaseClass {
  protected canRead(doc: FactMetricInterface): boolean {
    return this.context.hasPermission("readData", doc.projects || []);
  }
  protected canCreate(doc: FactMetricInterface): boolean {
    return this.context.permissions.canCreateFactMetric(doc);
  }
  protected canUpdate(
    existing: FactMetricInterface,
    updates: UpdateProps<FactMetricInterface>,
  ): boolean {
    return this.context.permissions.canUpdateFactMetric(existing, updates);
  }
  protected canDelete(doc: FactMetricInterface): boolean {
    return this.context.permissions.canDeleteFactMetric(doc);
  }

  // Every fact metric in the org, ignoring the caller's read permissions. Only
  // for authoritative dependency scans (e.g. blocking deletion of a fact table
  // column a metric still references), where missing a metric in a project the
  // caller cannot read would let the delete through and leave that metric
  // generating SQL for a column that no longer exists. Never return these to
  // the caller.
  public async dangerousGetAllForDependencyScan(): Promise<
    FactMetricInterface[]
  > {
    return this._find({}, { bypassReadPermissionChecks: true });
  }

  /**
   * Get all fact metrics with optional filters and DB-level sorting by id
   */
  public getAllSorted(options?: {
    datasourceId?: string;
    factTableId?: string;
    projectId?: string;
  }) {
    // Both the factTableId filter and projectFilterQuery use a top-level $or,
    // so combine them under $and to keep one from clobbering the other.
    const andClauses: FilterQuery<FactMetricInterface>[] = [];
    if (options?.factTableId) {
      andClauses.push({
        $or: [
          { "numerator.factTableId": options.factTableId },
          { "funnelSettings.steps.factTableId": options.factTableId },
        ],
      });
    }
    if (options?.projectId) {
      andClauses.push(projectFilterQuery(options.projectId));
    }

    const filter: FilterQuery<FactMetricInterface> = {
      ...(options?.datasourceId && { datasource: options.datasourceId }),
      ...(andClauses.length && { $and: andClauses }),
    };

    return this._find(filter, { sort: { id: 1 } });
  }

  public static upgradeFactMetricDoc(
    doc: LegacyFactMetricInterface,
  ): FactMetricInterface {
    const newDoc = { ...doc };

    if (doc.windowSettings === undefined) {
      newDoc.windowSettings = {
        type: doc.hasConversionWindow ? "conversion" : "",
        windowValue:
          doc.conversionWindowValue || DEFAULT_CONVERSION_WINDOW_HOURS,
        windowUnit: doc.conversionWindowUnit || "hours",
        delayValue: doc.conversionDelayHours || 0,
        delayUnit: "hours",
      };
    } else if (doc.windowSettings.delayValue === undefined) {
      newDoc.windowSettings = {
        ...doc.windowSettings,
        delayValue: doc.windowSettings.delayHours ?? 0,
        delayUnit: doc.windowSettings.delayUnit ?? "hours",
      };
      delete newDoc.windowSettings.delayHours;
    }

    if (doc.cappingSettings === undefined) {
      newDoc.cappingSettings = {
        type: doc.capping || "",
        value: doc.capValue || 0,
      };
    }

    if (doc.priorSettings === undefined) {
      newDoc.priorSettings = {
        override: false,
        proper: false,
        mean: 0,
        stddev: DEFAULT_PROPER_PRIOR_STDDEV,
      };
    }
    healPriorSettings(newDoc.priorSettings);

    if (newDoc.numerator) {
      newDoc.numerator = FactMetricModel.migrateColumnRef(newDoc.numerator);
    }

    // Fix Daily Participation metrics that have incorrect column values
    // These metrics require $$distinctDates to correctly generate COUNT(DISTINCT DATE(...))
    if (
      newDoc.metricType === "dailyParticipation" &&
      newDoc.numerator &&
      newDoc.numerator.column !== "$$distinctDates"
    ) {
      newDoc.numerator = {
        ...newDoc.numerator,
        column: "$$distinctDates",
        aggregation: undefined,
      };
    }

    // Clean up orphaned denominators that should not exist
    if (!denominatorRequiredByMetricType(newDoc.metricType)) {
      newDoc.denominator = null;
    }

    if (newDoc.denominator) {
      newDoc.denominator = FactMetricModel.migrateColumnRef(newDoc.denominator);
    }

    return newDoc as FactMetricInterface;
  }

  public static migrateColumnRef(columnRef: LegacyColumnRef): ColumnRef {
    const { filters, inlineFilters, ...newColumnRef } = columnRef;

    // The Mongo driver stores explicit `undefined` as null, which fails validation on later updates
    if ((newColumnRef.aggregation ?? null) === null) {
      delete newColumnRef.aggregation;
    }

    // If row filters are already defined, do nothing
    if (newColumnRef.rowFilters !== undefined) {
      return newColumnRef;
    }

    newColumnRef.rowFilters = [];

    if (filters) {
      for (const f of filters) {
        newColumnRef.rowFilters.push({
          operator: "saved_filter",
          values: [f],
        });
      }
    }

    if (inlineFilters) {
      for (const [column, values] of Object.entries(inlineFilters)) {
        const filteredValues = values.filter((v) => !!v);
        if (filteredValues.length === 0) continue;

        newColumnRef.rowFilters.push({
          operator: filteredValues.length > 1 ? "in" : "=",
          column,
          values: filteredValues,
        });
      }
    }

    return newColumnRef;
  }

  protected migrate(legacyDoc: unknown): FactMetricInterface {
    return FactMetricModel.upgradeFactMetricDoc(
      legacyDoc as LegacyFactMetricInterface,
    );
  }

  protected async beforeCreate(doc: FactMetricInterface) {
    if (!doc.id.match(/^fact__[-a-zA-Z0-9_]+$/)) {
      throw new Error(
        "Fact metric ids MUST start with 'fact__' and contain only letters, numbers, underscores, and dashes",
      );
    }

    if (doc.managedBy === "api" && !this.context.isApiRequest) {
      throw new Error(
        "Cannot create fact metric managed by API if the request isn't from the API.",
      );
    }

    if (
      doc.managedBy === "admin" &&
      !this.context.hasPremiumFeature("manage-official-resources")
    ) {
      throw new Error(
        "Your organization's plan does not support creating official fact metrics.",
      );
    }
  }

  protected async beforeUpdate(existing: FactMetricInterface) {
    // Check the admin permission here?
    if (existing.managedBy === "api" && !this.context.isApiRequest) {
      throw new Error(
        "Cannot update fact metric managed by API if the request isn't from the API.",
      );
    }
  }

  protected async beforeDelete(existing: FactMetricInterface) {
    // Check the admin permission here?
    if (existing.managedBy === "api" && !this.context.isApiRequest) {
      throw new Error(
        "Cannot delete fact metric managed by API if the request isn't from the API.",
      );
    }
  }

  protected async afterDelete(doc: FactMetricInterface) {
    await this.context.models.metricGroups.removeMetricFromAllGroups(doc.id);
  }

  // TODO: Once we migrate fact tables to new data model, we can use that instead
  private _factTableMap: Map<string, FactTableInterface> | null = null;
  private async getFactTableMap() {
    if (!this._factTableMap) {
      this._factTableMap = await getFactTableMap(this.context);
    }
    return this._factTableMap;
  }

  static async validateFactMetric(
    data: FactMetricInterface,
    previousData: FactMetricInterface | null,
    factTableMap: Map<string, FactTableInterface>,
    context: Context,
  ): Promise<void> {
    if (data.metricType === "funnel" && !data.funnelSettings) {
      throw new Error("Funnel settings required for funnel metrics");
    }
    if (data.metricType !== "funnel" && !data.numerator) {
      throw new Error("Numerator required for non-funnel metrics");
    }

    if (isFactFunnelMetric(data)) {
      if (!context.hasPremiumFeature("funnel-metrics")) {
        throw new Error("Funnel metrics are a premium feature");
      }
      await FactMetricModel.validateFunnelSettings(
        data,
        previousData,
        factTableMap,
        context,
      );
    } else {
      await FactMetricModel.validateColumnRefs(
        data,
        previousData,
        factTableMap,
        context,
      );
    }

    if (data.metricType === "quantile") {
      if (!context.hasPremiumFeature("quantile-metrics")) {
        throw new Error("Quantile metrics are a premium feature");
      }

      if (!data.quantileSettings) {
        throw new Error("Must specify `quantileSettings` for quantile metrics");
      }
    }
    if (
      data.metricType === "retention" &&
      !context.hasPremiumFeature("retention-metrics") &&
      data.id !== "fact__demo-d7-purchase-retention" // Allows demo retention metric to be created without premium feature
    ) {
      throw new Error("Retention metrics are a premium feature");
    }
    if (data.loseRisk < data.winRisk) {
      throw new Error(
        `riskThresholdDanger (${data.loseRisk}) must be greater than riskThresholdSuccess (${data.winRisk})`,
      );
    }

    if (data.minPercentChange >= data.maxPercentChange) {
      throw new Error(
        `maxPercentChange (${data.maxPercentChange}) must be greater than minPercentChange (${data.minPercentChange})`,
      );
    }

    validateReplaces(data);
  }

  protected async customValidation(
    data: FactMetricInterface,
    previousData?: FactMetricInterface,
  ): Promise<void> {
    await FactMetricModel.validateFactMetric(
      data,
      previousData ?? null,
      await this.getFactTableMap(),
      this.context,
    );
  }

  /**
   * Funnel metrics describe their events through ordered steps rather than a
   * numerator ColumnRef, so none of the column/aggregation rules apply.
   */
  private static async validateFunnelSettings(
    data: FunnelFactMetricInterface,
    existingMetric: FactMetricInterface | null,
    factTableMap: Map<string, FactTableInterface>,
    context: Context,
  ): Promise<void> {
    const { steps, ordering, sessionBased } = data.funnelSettings;
    if (steps.length < 2) {
      throw new Error("Funnel metrics need at least 2 steps");
    }
    // TODO(funnel): support non-sequential ordering
    if ((ordering ?? "sequential") !== "sequential") {
      throw new Error("Only sequential funnel ordering is supported for now");
    }
    // TODO(funnel): support session-based funnels
    if (sessionBased) {
      throw new Error("Session-based funnels are not supported for now");
    }

    // TODO(funnel): multi-fact table support for funnel metrics
    const factTableIds = new Set(steps.map((s) => s.factTableId));
    if (factTableIds.size > 1) {
      throw new Error(
        "All funnel steps must come from the same fact table for now",
      );
    }

    const factTableId = steps[0].factTableId;
    const factTable = factTableMap.get(factTableId);
    if (!factTable) {
      throw new Error("Could not find funnel fact table");
    }
    if (factTable.datasource !== data.datasource) {
      throw new Error(
        "Funnel Fact Table must belong to the metric's Data Source",
      );
    }

    steps.forEach((step, i) => {
      if (!step.name) {
        throw new Error(`Funnel step ${i + 1} must have a name`);
      }
      validateSavedFilterIds({
        columnRef: { factTableId, column: "", rowFilters: step.rowFilters },
        factTable,
        filterType: "numerator",
      });
    });

    if (data.numerator) {
      throw new Error("Numerator not allowed for funnel metrics");
    }
    if (data.denominator) {
      throw new Error("Denominator not allowed for funnel metrics");
    }
    if (data.cappingSettings.type) {
      throw new Error("Capping is not supported for funnel metrics");
    }
    if (data.quantileSettings) {
      throw new Error("Quantile settings are not supported for funnel metrics");
    }
    if (data.metricAutoSlices?.length) {
      throw new Error("Slices are not supported for funnel metrics");
    }

    const previousSteps =
      existingMetric && isFactFunnelMetric(existingMetric)
        ? existingMetric.funnelSettings.steps
        : [];
    const rowFiltersToValidate = steps.flatMap((step, index) =>
      getNetNewSqlExprRowFilters({
        rowFilters: step.rowFilters,
        previousRowFilters: previousSteps[index]?.rowFilters,
        validateAll: previousSteps[index]?.factTableId !== step.factTableId,
      }),
    );
    if (!rowFiltersToValidate.length) return;

    const datasource = await getDataSourceById(context, data.datasource);
    if (!datasource) {
      throw new Error("Could not find datasource");
    }
    const integration = getSourceIntegrationObject(context, datasource, true);
    await validateFactMetricRowFilterSql({
      integration,
      factTable,
      rowFilters: rowFiltersToValidate,
      errorPrefix: "Invalid funnel step row filter SQL: ",
    });
  }

  private static async validateColumnRefs(
    data: StandardFactMetricInterface,
    existingMetric: FactMetricInterface | null,
    factTableMap: Map<string, FactTableInterface>,
    context: Context,
  ): Promise<void> {
    if (data.funnelSettings) {
      throw new Error("funnelSettings is only allowed for funnel metrics");
    }

    const numeratorFactTable = factTableMap.get(data.numerator.factTableId);
    if (!numeratorFactTable) {
      throw new Error("Could not find numerator fact table");
    }
    if (numeratorFactTable.datasource !== data.datasource) {
      throw new Error(
        "Numerator Fact Table must belong to the metric's Data Source",
      );
    }

    validateSavedFilterIds({
      columnRef: data.numerator,
      factTable: numeratorFactTable,
      filterType: "numerator",
    });

    // Validate aggregation/datatype constraints (runs for every code path
    // that hits BaseModel — internal UI controllers, external API,
    // bulk import, etc.)
    validateAggregationSpecification({
      errorPrefix: "Numerator misspecified. ",
      column: data.numerator,
      factTable: numeratorFactTable,
      metricType: data.metricType,
      quantileType: data.quantileSettings?.type,
      quantileIgnoreZeros: data.quantileSettings?.ignoreZeros,
      quantileEventCountColumn: data.quantileSettings?.quantileEventCountColumn,
    });

    // validate column
    const metricSupportsDistinctDates =
      data.metricType === "mean" ||
      data.metricType === "ratio" ||
      data.metricType === "dailyParticipation" ||
      (data.metricType === "quantile" &&
        data.quantileSettings?.type === "unit");
    if (data.numerator.column === "$$distinctDates") {
      if (!metricSupportsDistinctDates) {
        throw new Error(
          "$$distinctDates is only supported for mean, ratio, daily participation, and quantile metrics",
        );
      }
    }

    // validate user filter
    if (
      data.numerator.aggregateFilterColumn ||
      data.numerator.aggregateFilter
    ) {
      validateUserFilter({
        metricType: data.metricType,
        numerator: data.numerator,
        factTable: numeratorFactTable,
      });
    }

    let denominatorFactTable: FactTableInterface | null = null;
    if (data.metricType === "ratio") {
      if (!data.denominator) {
        throw new Error("Denominator required for ratio metric");
      }
      denominatorFactTable =
        data.denominator.factTableId === data.numerator.factTableId
          ? numeratorFactTable
          : factTableMap.get(data.denominator.factTableId) || null;

      if (!denominatorFactTable) {
        throw new Error("Could not find denominator fact table");
      }
      if (denominatorFactTable.datasource !== numeratorFactTable.datasource) {
        throw new Error(
          "Numerator and denominator must be in the same datasource",
        );
      }

      validateSavedFilterIds({
        columnRef: data.denominator,
        factTable: denominatorFactTable,
        filterType: "denominator",
      });

      validateAggregationSpecification({
        errorPrefix: "Denominator misspecified. ",
        column: data.denominator,
        factTable: denominatorFactTable,
        metricType: data.metricType,
        quantileType: data.quantileSettings?.type,
        quantileIgnoreZeros: data.quantileSettings?.ignoreZeros,
        // Override is numerator-only; never relevant for denominators.
        quantileEventCountColumn: undefined,
      });
    } else if (data.denominator?.factTableId) {
      throw new Error("Denominator not allowed for non-ratio metric");
    }

    const numeratorSqlExprFiltersToValidate = getNetNewSqlExprRowFilters({
      rowFilters: data.numerator.rowFilters,
      previousRowFilters: existingMetric?.numerator?.rowFilters,
      validateAll:
        !existingMetric ||
        existingMetric.numerator?.factTableId !== data.numerator.factTableId,
    });

    const denominatorSqlExprFiltersToValidate =
      denominatorFactTable && data.denominator
        ? getNetNewSqlExprRowFilters({
            rowFilters: data.denominator.rowFilters,
            previousRowFilters: existingMetric?.denominator?.rowFilters,
            validateAll:
              !existingMetric ||
              existingMetric.denominator?.factTableId !==
                data.denominator.factTableId,
          })
        : [];

    if (
      numeratorSqlExprFiltersToValidate.length ||
      denominatorSqlExprFiltersToValidate.length
    ) {
      const datasource = await getDataSourceById(context, data.datasource);
      if (!datasource) {
        throw new Error("Could not find datasource");
      }
      const integration = getSourceIntegrationObject(context, datasource, true);

      await validateFactMetricRowFilterSql({
        integration,
        factTable: numeratorFactTable,
        rowFilters: numeratorSqlExprFiltersToValidate,
        errorPrefix: "Invalid numerator row filter SQL: ",
      });

      if (denominatorFactTable && data.denominator) {
        await validateFactMetricRowFilterSql({
          integration,
          factTable: denominatorFactTable,
          rowFilters: denominatorSqlExprFiltersToValidate,
          errorPrefix: "Invalid denominator row filter SQL: ",
        });
      }
    }
  }

  public async projectHasFactMetrics(projectId: string): Promise<boolean> {
    const factMetrics = await this._find({
      projects: [projectId],
    });
    return factMetrics.length > 0;
  }

  public async deleteAllFactMetricsForAProject(projectId: string) {
    const factMetrics = await this._find({
      projects: [projectId],
    });
    await promiseAllChunks(
      factMetrics.map(
        (factMetric) => async () => await this.delete(factMetric),
      ),
      5,
    );
  }

  public static addLegacyFiltersToColumnRef(
    columnRef: ColumnRef,
  ): LegacyColumnRef {
    const newColumnRef: LegacyColumnRef = {
      ...columnRef,
      filters: [],
      inlineFilters: {},
    };

    newColumnRef.rowFilters?.forEach((rf) => {
      if (rf.operator === "saved_filter") {
        newColumnRef.filters?.push(rf.values?.[0] || "");
      } else if (rf.operator === "=" || rf.operator === "in") {
        newColumnRef.inlineFilters = newColumnRef.inlineFilters || {};
        newColumnRef.inlineFilters[rf.column || ""] = rf.values || [];
      } else if (rf.operator === "is_true" || rf.operator === "is_false") {
        newColumnRef.inlineFilters = newColumnRef.inlineFilters || {};
        newColumnRef.inlineFilters[rf.column || ""] = [
          rf.operator === "is_true" ? "true" : "false",
        ];
      }
    });

    return newColumnRef;
  }

  public toApiInterface(factMetric: FactMetricInterface): ApiFactMetric {
    const {
      quantileSettings,
      funnelSettings,
      cappingSettings,
      windowSettings,
      regressionAdjustmentDays,
      regressionAdjustmentEnabled,
      regressionAdjustmentOverride,
      dateCreated,
      dateUpdated,
      numerator,
      denominator,
      metricType,
      loseRisk,
      winRisk,
      targetMDE,
      ...otherFields
    } = omit(factMetric, ["organization"]);

    return {
      ...otherFields,
      riskThresholdDanger: loseRisk,
      riskThresholdSuccess: winRisk,
      targetMDE: targetMDE || DEFAULT_TARGET_MDE,
      metricType: metricType,
      quantileSettings: quantileSettings || undefined,
      funnelSettings: funnelSettings || undefined,
      cappingSettings: {
        ...cappingSettings,
        type: cappingSettings.type || "none",
        ignoreZeros: cappingSettings.ignoreZeros ?? undefined,
      },
      windowSettings: {
        ...windowSettings,
        type: windowSettings.type || "none",
      },
      managedBy: factMetric.managedBy || "",
      numerator: numerator
        ? FactMetricModel.addLegacyFiltersToColumnRef(numerator)
        : undefined,
      denominator: denominator
        ? FactMetricModel.addLegacyFiltersToColumnRef(denominator)
        : undefined,
      regressionAdjustmentSettings: {
        override: regressionAdjustmentOverride || false,
        ...(regressionAdjustmentOverride
          ? {
              enabled: regressionAdjustmentEnabled || false,
            }
          : null),
        ...(regressionAdjustmentOverride && regressionAdjustmentEnabled
          ? {
              days: regressionAdjustmentDays || 0,
            }
          : null),
      },
      dateCreated: dateCreated?.toISOString() || "",
      dateUpdated: dateUpdated?.toISOString() || "",
    };
  }
}
