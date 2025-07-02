import React, { useCallback, useEffect, useState } from "react";
import {
  ExperimentSnapshotAnalysis,
  ExperimentSnapshotAnalysisSettings,
  ExperimentSnapshotInterface,
} from "back-end/types/experiment-snapshot";
import { DifferenceType } from "back-end/types/stats";
import { Flex } from "@radix-ui/themes";
import { getExposureQuery } from "@/services/datasources";
import { useDefinitions } from "@/services/DefinitionsContext";
import SelectField from "@/components/Forms/SelectField";
import { SSRPolyfills } from "@/hooks/useSSRPolyfills";
import { analysisUpdate } from "@/components/Experiment/DifferenceTypeChooser";
import { useAuth } from "@/services/auth";
import track from "@/services/track";
import LoadingSpinner from "@/components/LoadingSpinner";

export interface Props {
  value: string;
  setValue?: (value: string | null) => void;
  precomputedDimensions?: string[];
  setValueFromPrecomputed?: (value: string | null) => void;
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
  analysis?: ExperimentSnapshotAnalysis;
  snapshot?: ExperimentSnapshotInterface;
  mutate?: () => void;
  setAnalysisSettings?: (
    settings: ExperimentSnapshotAnalysisSettings | null
  ) => void;
  disabled?: boolean;
  ssrPolyfills?: SSRPolyfills;
}

export default function DimensionChooser({
  value,
  setValue,
  precomputedDimensions,
  setValueFromPrecomputed,
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
  analysis,
  snapshot,
  mutate,
  setAnalysisSettings,
  disabled,
  ssrPolyfills,
}: Props) {
  const { apiCall } = useAuth();

  const [postLoading, setPostLoading] = useState(false);
  const { dimensions, getDatasourceById, getDimensionById } = useDefinitions();
  const datasource = datasourceId ? getDatasourceById(datasourceId) : null;

  // If activation metric is not selected, don't allow using that dimension
  useEffect(() => {
    if (value === "pre:activation" && !activationMetric) {
      setValue?.("");
    }
  }, [value, setValue, activationMetric]);

  const triggerAnalysisUpdate = useCallback(analysisUpdate, [
    analysis,
    snapshot,
    apiCall,
  ]);

  // Include user dimensions tied to the datasource
  const filteredDimensions = dimensions
    .filter((d) => d.datasource === datasourceId)
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

  const precomputedDimensionOptions =
    precomputedDimensions?.map((d) => ({
      label: d.replace("precomputed:", ""),
      value: d,
    })) ?? [];

  // remove precomputed dimensions from the on-demand dimensions
  // TODO add workaround
  const onDemandDimensions = [
    ...builtInDimensions,
    ...filteredDimensions,
  ].filter(
    (d) =>
      !precomputedDimensionOptions
        .map((p) => p.value.replace("precomputed:", "exp:"))
        .includes(d.value)
  );

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
      <Flex direction="row" gap="1" align="center">
        <SelectField
          label={newUi ? undefined : "Dimension"}
          labelClassName={labelClassName}
          containerClassName={newUi ? "select-dropdown-underline" : ""}
          options={[
            ...(precomputedDimensionOptions.length > 0
              ? [
                  {
                    label: "Pre-computed",
                    options: precomputedDimensionOptions,
                  },
                ]
              : []),
            ...(onDemandDimensions.length > 0
              ? [
                  {
                    label: "On-demand",
                    options: onDemandDimensions,
                  },
                ]
              : []),
          ]}
          formatGroupLabel={({ label }) => (
            <div className="pt-2 pb-1 border-bottom">{label}</div>
          )}
          initialOption="None"
          value={value}
          onChange={(v) => {
            if (v === value) return;
            if (precomputedDimensionOptions.map((d) => d.value).includes(v)) {
              // TODO reload old snapshot
              setValue?.(null);
              setValueFromPrecomputed?.(v);
              if (analysis && snapshot) {
                const newSettings: ExperimentSnapshotAnalysisSettings = {
                  ...analysis.settings,
                  dimensions: [v],
                };
                triggerAnalysisUpdate(
                  newSettings,
                  analysis,
                  snapshot,
                  apiCall,
                  setPostLoading
                )
                  .then((status) => {
                    if (status === "success") {
                      setValue?.(null);
                      setAnalysisSettings?.(newSettings);
                      track(
                        "Experiment Analysis: switch precomputed-dimension",
                        {
                          dimension: v,
                        }
                      );
                      mutate?.();
                    }
                    setPostLoading(false);
                  })
                  .catch(() => {
                    setValue?.(value);
                    setPostLoading(false);
                  });
              }
            } else {
              setAnalysisSettings?.(null);
              setBaselineRow?.(0);
              setDifferenceType?.("relative");
              setVariationFilter?.([]);
              setValue?.(v);
              setValueFromPrecomputed?.(null);
            }
          }}
          sort={false}
          helpText={
            showHelp ? "Break down results for each metric by a dimension" : ""
          }
          disabled={disabled}
        />
        {postLoading && <LoadingSpinner className="ml-1" />}
      </Flex>
    </div>
  );
}
