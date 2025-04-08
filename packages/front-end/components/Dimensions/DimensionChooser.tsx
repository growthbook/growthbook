import React, { useEffect } from "react";
import { ExperimentSnapshotAnalysisSettings } from "back-end/types/experiment-snapshot";
import { DifferenceType } from "back-end/types/stats";
import { getExposureQuery } from "@/services/datasources";
import { useDefinitions } from "@/services/DefinitionsContext";
import SelectField from "@/components/Forms/SelectField";

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
}: Props) {
  const { dimensions, getDatasourceById } = useDefinitions();
  const datasource = datasourceId ? getDatasourceById(datasourceId) : null;

  // If activation metric is not selected, don't allow using that dimension
  useEffect(() => {
    if (value === "pre:activation" && !activationMetric) {
      setValue?.("");
    }
  }, [value, setValue, activationMetric]);

  // Don't show anything if the datasource doesn't support dimensions
  if (!datasource || !datasource.properties?.dimensions) {
    return null;
  }

  // Include user dimensions tied to the datasource
  const filteredDimensions = dimensions
    .filter((d) => d.datasource === datasourceId)
    .map((d) => {
      return {
        label: d.name,
        value: d.id,
      };
    });

  const exposureQuery = getExposureQuery(
    datasource.settings,
    exposureQueryId,
    userIdType
  );
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
      label: "日期群组（首次曝光）",
      value: "pre:date",
    },
  ];
  // Activation status is only available when an activation metric is chosen
  if (datasource.properties?.activationDimension && activationMetric) {
    builtInDimensions.push({
      label: "激活状态",
      value: "pre:activation",
    });
  }

  return (
    <div>
      {newUi && <div className="uppercase-title text-muted">维度</div>}
      <SelectField
        label={newUi ? undefined : "维度"}
        labelClassName={labelClassName}
        containerClassName={newUi ? "select-dropdown-underline" : ""}
        options={[
          {
            label: "内置",
            options: builtInDimensions,
          },
          {
            label: "自定义",
            options: filteredDimensions,
          },
        ]}
        formatGroupLabel={({ label }) => (
          <div className="pt-2 pb-1 border-bottom">{label}</div>
        )}
        initialOption="无"
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
          showHelp ? "按维度细分每个指标的结果" : ""
        }
        disabled={disabled}
      />
    </div>
  );
}
