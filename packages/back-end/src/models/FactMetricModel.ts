import { omit } from "lodash";
import {
  DEFAULT_PROPER_PRIOR_STDDEV,
  DEFAULT_TARGET_MDE,
} from "shared/constants";
import {
  getAggregateFilters,
  getSelectedColumnDatatype,
} from "shared/experiments";
import { UpdateProps } from "shared/types/base-model";
import { factMetricValidator } from "shared/validators";
import {
  ColumnRef,
  FactMetricInterface,
  FactMetricType,
  FactTableInterface,
  LegacyColumnRef,
  LegacyFactMetricInterface,
} from "back-end/types/fact-table";
import { ApiFactMetric } from "back-end/types/openapi";
import { DEFAULT_CONVERSION_WINDOW_HOURS } from "back-end/src/util/secrets";
import { promiseAllChunks } from "../util/promise";
import { MakeModelClass } from "./BaseModel";
import { getFactTableMap } from "./FactTableModel";

const BaseClass = MakeModelClass({
  schema: factMetricValidator,
  collectionName: "factmetrics",
  idPrefix: "fact__",
  auditLog: {
    entity: "metric",
    createEvent: "metric.create",
    updateEvent: "metric.update",
    deleteEvent: "metric.delete",
  },
  globallyUniqueIds: false,
  readonlyFields: ["datasource"],
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

function denominatorRequiredByMetricType(metricType: FactMetricType): boolean {
  switch (metricType) {
    case "mean":
    case "dailyParticipation":
    case "quantile":
    case "retention":
    case "proportion":
      return false;
    case "ratio":
      return true;
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

    if (newDoc.numerator) {
      newDoc.numerator = FactMetricModel.migrateColumnRef(newDoc.numerator);
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

  // TODO: Once we migrate fact tables to new data model, we can use that instead
  private _factTableMap: Map<string, FactTableInterface> | null = null;
  private async getFactTableMap() {
    if (!this._factTableMap) {
      this._factTableMap = await getFactTableMap(this.context);
    }
    return this._factTableMap;
  }

  protected async customValidation(data: FactMetricInterface): Promise<void> {
    const factTableMap = await this.getFactTableMap();

    const numeratorFactTable = factTableMap.get(data.numerator.factTableId);
    if (!numeratorFactTable) {
      throw new Error("Could not find numerator fact table");
    }

    if (data.numerator.rowFilters?.length) {
      for (const filter of data.numerator.rowFilters) {
        const filterId = filter.values?.[0];
        if (
          filter.operator === "saved_filter" &&
          filterId &&
          !numeratorFactTable.filters.some((f) => f.id === filterId)
        ) {
          throw new Error(`Invalid numerator filter id: ${filterId}`);
        }
      }
    }

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

    if (data.metricType === "ratio") {
      if (!data.denominator) {
        throw new Error("Denominator required for ratio metric");
      }
      if (data.denominator.factTableId !== data.numerator.factTableId) {
        const denominatorFactTable = factTableMap.get(
          data.denominator.factTableId,
        );
        if (!denominatorFactTable) {
          throw new Error("Could not find denominator fact table");
        }
        if (denominatorFactTable.datasource !== numeratorFactTable.datasource) {
          throw new Error(
            "Numerator and denominator must be in the same datasource",
          );
        }

        if (data.denominator.rowFilters?.length) {
          for (const filter of data.denominator.rowFilters) {
            const filterId = filter.values?.[0];
            if (
              filter.operator === "saved_filter" &&
              filterId &&
              !denominatorFactTable.filters.some((f) => f.id === filterId)
            ) {
              throw new Error(`Invalid denominator filter id: ${filterId}`);
            }
          }
        }
      }
    } else if (data.denominator?.factTableId) {
      throw new Error("Denominator not allowed for non-ratio metric");
    }
    if (data.metricType === "quantile") {
      if (!this.context.hasPremiumFeature("quantile-metrics")) {
        throw new Error("Quantile metrics are a premium feature");
      }

      if (!data.quantileSettings) {
        throw new Error("Must specify `quantileSettings` for quantile metrics");
      }
    }
    if (
      data.metricType === "retention" &&
      !this.context.hasPremiumFeature("retention-metrics") &&
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
      cappingSettings: {
        ...cappingSettings,
        type: cappingSettings.type || "none",
      },
      windowSettings: {
        ...windowSettings,
        type: windowSettings.type || "none",
      },
      managedBy: factMetric.managedBy || "",
      numerator: FactMetricModel.addLegacyFiltersToColumnRef(numerator),
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
