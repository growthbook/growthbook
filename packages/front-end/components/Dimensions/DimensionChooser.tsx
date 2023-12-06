import { useEffect } from "react";
import { ExperimentSnapshotAnalysisSettings } from "back-end/types/experiment-snapshot";
import { DifferenceType } from "back-end/types/stats";
import { getExposureQuery } from "@/services/datasources";
import { useDefinitions } from "@/services/DefinitionsContext";
import SelectField from "../Forms/SelectField";

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
  newUi = false,
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
      label: "Date Cohorts (First Exposure)",
      value: "pre:date",
    },
  ];
  // Activation status is only available when an activation metric is chosen
  if (datasource.properties?.activationDimension && activationMetric) {
    builtInDimensions.push({
      label: "Activation status",
      value: "pre:activation",
    });
  }

  return (
    <div>
      {newUi && <div className="uppercase-title text-muted">Dimension</div>}
      <SelectField
        label={newUi ? undefined : "Dimension"}
        labelClassName={labelClassName}
        containerClassName={newUi ? "select-dropdown-underline" : ""}
        options={[
          {
            label: "Built-in",
            options: builtInDimensions,
          },
          {
            label: "Custom",
            options: filteredDimensions,
          },
        ]}
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
