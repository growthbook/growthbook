import React, { useEffect } from "react";
import { ExperimentSnapshotAnalysisSettings } from "back-end/types/experiment-snapshot";
import { DifferenceType } from "back-end/types/stats";
import { DataSourceInterfaceWithParams } from "back-end/types/datasource";
import { DimensionInterface } from "back-end/types/dimension";
import { getExposureQuery } from "@/services/datasources";
import { useDefinitions } from "@/services/DefinitionsContext";
import SelectField, { GroupedValue } from "@/components/Forms/SelectField";
import { SSRPolyfills } from "@/hooks/useSSRPolyfills";

export interface Props {
  value: string;
  setValue?: (value: string) => void;
  datasourceId?: string;
  exposureQueryId?: string;
  activationMetric?: boolean;
  userIdType?: "user" | "anonymous";
  labelClassName?: string;
  showHelp?: boolean;
  newUi?: boolean;
  setVariationFilter?: (variationFilter: number[]) => void;
  setBaselineRow?: (baselineRow: number) => void;
  setDifferenceType?: (differenceType: DifferenceType) => void;
  setAnalysisSettings?: (
    settings: ExperimentSnapshotAnalysisSettings | null
  ) => void;
  disabled?: boolean;
  ssrPolyfills?: SSRPolyfills;
}

export function getDimensionOptions({
  datasource,
  dimensions,
  exposureQueryId,
  userIdType,
  activationMetric,
}: {
  datasource: DataSourceInterfaceWithParams | null;
  dimensions: DimensionInterface[];
  exposureQueryId?: string;
  userIdType?: string;
  activationMetric?: boolean;
}): GroupedValue[] {
  // Include user dimensions tied to the datasource
  const filteredDimensions = dimensions
    .filter((d) => d.datasource === datasource?.id)
    .map((d) => {
      return {
        label: d.name,
        value: d.id,
      };
    });

  const exposureQuery = datasource?.settings
    ? getExposureQuery(datasource.settings, exposureQueryId, userIdType)
    : null;
  // Add experiment dimensions based on the selected exposure query
  if (exposureQuery) {
    if (exposureQuery.dimensions.length > 0) {
      exposureQuery.dimensions.forEach((d) => {
        filteredDimensions.push({
          label: d,
          value: "exp:" + d,
        });
      });
    }
  }
  // Legacy data sources - add experiment dimensions
  else if ((datasource?.settings?.experimentDimensions?.length ?? 0) > 0) {
    datasource?.settings?.experimentDimensions?.forEach((d) => {
      filteredDimensions.push({
        label: d,
        value: "exp:" + d,
      });
    });
  }

  // Date is always available
  const builtInDimensions = [
    {
      label: "Date Cohorts (First Exposure)",
      value: "pre:date",
    },
  ];
  // Activation status is only available when an activation metric is chosen
  if (datasource?.properties?.activationDimension && activationMetric) {
    builtInDimensions.push({
      label: "Activation status",
      value: "pre:activation",
    });
  }

  return [
    {
      label: "Built-in",
      options: builtInDimensions,
    },
    {
      label: "Custom",
      options: filteredDimensions,
    },
  ];
}

export default function DimensionChooser({
  value,
  setValue,
  datasourceId,
  exposureQueryId,
  activationMetric,
  userIdType,
  labelClassName,
  showHelp,
  newUi = true,
  setVariationFilter,
  setBaselineRow,
  setDifferenceType,
  setAnalysisSettings,
  disabled,
  ssrPolyfills,
}: Props) {
  const { dimensions, getDatasourceById, getDimensionById } = useDefinitions();
  const datasource = datasourceId ? getDatasourceById(datasourceId) : null;

  // If activation metric is not selected, don't allow using that dimension
  useEffect(() => {
    if (value === "pre:activation" && !activationMetric) {
      setValue?.("");
    }
  }, [value, setValue, activationMetric]);

  const dimensionOptions = getDimensionOptions({
    exposureQueryId,
    userIdType,
    datasource,
    dimensions,
    activationMetric,
  });

  if (disabled) {
    const dimensionName =
      ssrPolyfills?.getDimensionById?.(value)?.name ||
      getDimensionById(value)?.name ||
      (value === "pre:date" ? "Date Cohorts (First Exposure)" : "") ||
      (value === "pre:activation" ? "Activation status" : "") ||
      value?.split(":")?.[1] ||
      "None";
    return (
      <div>
        <div className="uppercase-title text-muted">Dimension</div>
        <div>{dimensionName}</div>
      </div>
    );
  }

  return (
    <div>
      {newUi && <div className="uppercase-title text-muted">Dimension</div>}
      <SelectField
        label={newUi ? undefined : "Dimension"}
        labelClassName={labelClassName}
        containerClassName={newUi ? "select-dropdown-underline" : ""}
        options={dimensionOptions}
        formatGroupLabel={({ label }) => (
          <div className="pt-2 pb-1 border-bottom">{label}</div>
        )}
        initialOption="None"
        value={value}
        onChange={(v) => {
          if (v === value) return;
          setAnalysisSettings?.(null);
          setBaselineRow?.(0);
          setDifferenceType?.("relative");
          setVariationFilter?.([]);
          setValue?.(v);
        }}
        helpText={
          showHelp ? "Break down results for each metric by a dimension" : ""
        }
        disabled={disabled}
      />
    </div>
  );
}
