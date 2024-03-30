import { omit } from "lodash";
import {
  FactMetricInterface,
  FactTableInterface,
  LegacyFactMetricInterface,
} from "../../types/fact-table";
import { ApiFactMetric } from "../../types/openapi";
import { factMetricValidator } from "../routers/fact-table/fact-table.validators";
import { DEFAULT_CONVERSION_WINDOW_HOURS } from "../util/secrets";
import { UpdateProps } from "../../types/models";
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
  projectScoping: "multiple",
  globallyUniqueIds: false,
  readonlyFields: ["datasource"],
});

export class FactMetricModel extends BaseClass {
  protected async canRead(doc: FactMetricInterface): Promise<boolean> {
    return this.context.hasPermission("readData", doc.projects || []);
  }
  protected async canCreate(doc: FactMetricInterface): Promise<boolean> {
    return this.context.permissions.canCreateMetric(doc);
  }
  protected async canUpdate(
    existing: FactMetricInterface,
    updates: UpdateProps<FactMetricInterface>
  ): Promise<boolean> {
    return this.context.permissions.canUpdateMetric(existing, updates);
  }
  protected async canDelete(doc: FactMetricInterface): Promise<boolean> {
    return this.context.permissions.canDeleteMetric(doc);
  }

  public static upgradeFactMetricDoc(
    doc: LegacyFactMetricInterface
  ): FactMetricInterface {
    const newDoc: FactMetricInterface = { ...doc };

    if (doc.windowSettings === undefined) {
      newDoc.windowSettings = {
        type: doc.hasConversionWindow ? "conversion" : "",
        windowValue:
          doc.conversionWindowValue || DEFAULT_CONVERSION_WINDOW_HOURS,
        windowUnit: doc.conversionWindowUnit || "hours",
        delayHours: doc.conversionDelayHours || 0,
      };
    }

    if (doc.cappingSettings === undefined) {
      newDoc.cappingSettings = {
        type: doc.capping || "",
        value: doc.capValue || 0,
      };
    }

    return newDoc;
  }

  protected migrate(legacyDoc: unknown): FactMetricInterface {
    return FactMetricModel.upgradeFactMetricDoc(
      legacyDoc as LegacyFactMetricInterface
    );
  }

  protected async beforeCreate(doc: FactMetricInterface) {
    if (!doc.id.match(/^fact__[-a-zA-Z0-9_]+$/)) {
      throw new Error(
        "Fact metric ids MUST start with 'fact__' and contain only letters, numbers, underscores, and dashes"
      );
    }
  }

  protected async beforeUpdate(existing: FactMetricInterface) {
    if (existing.managedBy === "api" && !this.context.isApiRequest) {
      throw new Error("Cannot update fact metric managed by API");
    }
  }

  protected async beforeDelete(existing: FactMetricInterface) {
    if (existing.managedBy === "api" && !this.context.isApiRequest) {
      throw new Error("Cannot delete fact metric managed by API");
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

    if (data.numerator.filters?.length) {
      for (const filter of data.numerator.filters) {
        if (!numeratorFactTable.filters.some((f) => f.id === filter)) {
          throw new Error(`Invalid numerator filter id: ${filter}`);
        }
      }
    }

    if (data.metricType === "ratio") {
      if (!data.denominator) {
        throw new Error("Denominator required for ratio metric");
      }
      if (data.denominator.factTableId !== data.numerator.factTableId) {
        const denominatorFactTable = factTableMap.get(
          data.denominator.factTableId
        );
        if (!denominatorFactTable) {
          throw new Error("Could not find denominator fact table");
        }
        if (denominatorFactTable.datasource !== numeratorFactTable.datasource) {
          throw new Error(
            "Numerator and denominator must be in the same datasource"
          );
        }

        if (data.denominator.filters?.length) {
          for (const filter of data.denominator.filters) {
            if (!denominatorFactTable.filters.some((f) => f.id === filter)) {
              throw new Error(`Invalid denominator filter id: ${filter}`);
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
        throw new Error("Must specify `quantileSettings` for Quantile metrics");
      }
    }
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
      denominator,
      metricType,
      ...otherFields
    } = omit(factMetric, ["organization"]);

    return {
      ...otherFields,
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
      denominator: denominator || undefined,
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
