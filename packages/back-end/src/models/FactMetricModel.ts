import { omit } from "lodash";
import {
  CreateFactMetricProps,
  FactMetricInterface,
} from "../../types/fact-table";
import { ApiFactMetric } from "../../types/openapi";
import { BaseModel, ModelConfig } from "./BaseModel";

export class FactMetricDataModel extends BaseModel<FactMetricInterface> {
  protected config: ModelConfig<FactMetricInterface> = {
    collectionName: "factmetrics",
    idPrefix: "fact__",
    writePermission: "createMetrics",
    projectScoping: "multiple",
    globallyUniqueIds: false,
    readonlyFields: ["datasource"],
  };

  protected async beforeCreate(props: CreateFactMetricProps) {
    if (props.id && !props.id.match(/^fact__[-a-zA-Z0-9_]+$/)) {
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

  public toApiInterface(factMetric: FactMetricInterface): ApiFactMetric {
    const {
      capValue,
      capping,
      conversionDelayHours,
      conversionWindowUnit,
      conversionWindowValue,
      hasConversionWindow,
      regressionAdjustmentDays,
      regressionAdjustmentEnabled,
      regressionAdjustmentOverride,
      dateCreated,
      dateUpdated,
      denominator,
      ...otherFields
    } = omit(factMetric, ["organization"]);

    return {
      ...otherFields,
      managedBy: factMetric.managedBy || "",
      denominator: denominator || undefined,
      cappingSettings: {
        type: capping || "none",
        value: capValue || 0,
      },
      windowSettings: {
        type: hasConversionWindow ? "conversion" : "none",
        delayHours: conversionDelayHours || 0,
        ...(hasConversionWindow
          ? {
              windowValue: conversionWindowValue || 0,
              windowUnit: conversionWindowUnit || "hours",
            }
          : null),
      },
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
