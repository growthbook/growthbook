import React, { useCallback, useEffect, useState } from "react";
import {
  ExperimentSnapshotAnalysis,
  ExperimentSnapshotAnalysisSettings,
  ExperimentSnapshotInterface,
} from "back-end/types/experiment-snapshot";
import { Flex } from "@radix-ui/themes";
import { getSnapshotAnalysis } from "shared/src/util";
import { DataSourceInterfaceWithParams } from "back-end/types/datasource";
import { DimensionInterface } from "back-end/types/dimension";
import { getExposureQuery } from "@/services/datasources";
import { useDefinitions } from "@/services/DefinitionsContext";
import SelectField, { GroupedValue } from "@/components/Forms/SelectField";
import { SSRPolyfills } from "@/hooks/useSSRPolyfills";
import { analysisUpdate } from "@/components/Experiment/DifferenceTypeChooser";
import { useAuth } from "@/services/auth";
import track from "@/services/track";
import LoadingSpinner from "@/components/LoadingSpinner";
import { useSnapshot } from "@/components/Experiment/SnapshotProvider";

export interface Props {
  value: string;
  setValue?: (value: string, resetOtherSettings?: boolean) => void;
  // Array of dimensions that should have been precomputed; the name
  // prepended with "precomputed:"
  precomputedDimensions?: string[];
  datasourceId?: string;
  exposureQueryId?: string;
  activationMetric?: boolean;
  userIdType?: "user" | "anonymous";
  labelClassName?: string;
  showHelp?: boolean;
  newUi?: boolean;
  resetAnalysisBarSettings?: () => void;
  analysis?: ExperimentSnapshotAnalysis;
  snapshot?: ExperimentSnapshotInterface;
  mutate?: () => void;
  setSnapshotDimension?: (dimension: string) => void;
  setAnalysisSettings?: (
    settings: ExperimentSnapshotAnalysisSettings | null,
  ) => void;
  disabled?: boolean;
  ssrPolyfills?: SSRPolyfills;
}

export function getDimensionOptions({
  precomputedDimensions,
  datasource,
  dimensions,
  activationMetric,
  exposureQueryId,
  userIdType,
}: {
  precomputedDimensions?: string[];
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

  const precomputedDimensionOptions =
    precomputedDimensions?.map((d) => ({
      label: d.replace("precomputed:", ""),
      value: d,
    })) ?? [];

  const exposureQuery = datasource?.settings
    ? getExposureQuery(datasource.settings, exposureQueryId, userIdType)
    : null;
  // Add experiment dimensions based on the selected exposure query
  if (exposureQuery) {
    if (exposureQuery.dimensions.length > 0) {
      exposureQuery.dimensions.forEach((d) => {
        // skip pre-computed dimensions
        if (precomputedDimensionOptions.some((p) => p.label === d)) {
          return;
        }
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

  const onDemandDimensions = [...builtInDimensions, ...filteredDimensions];

  return [
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
  ];
}

export default function DimensionChooser({
  value,
  setValue,
  precomputedDimensions,
  datasourceId,
  exposureQueryId,
  activationMetric,
  userIdType,
  labelClassName,
  showHelp,
  newUi = true,
  analysis,
  snapshot,
  mutate,
  setSnapshotDimension,
  setAnalysisSettings,
  disabled,
  ssrPolyfills,
}: Props) {
  const { apiCall } = useAuth();

  const [postLoading, setPostLoading] = useState(false);
  const { dimensions, getDatasourceById, getDimensionById } = useDefinitions();
  const { dimensionless: standardSnapshot } = useSnapshot();
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

  const dimensionOptions = getDimensionOptions({
    precomputedDimensions,
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
      <Flex direction="row" gap="1" align="center">
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
            setPostLoading(true);
            setValue?.(v);
            if (precomputedDimensions?.includes(v)) {
              const defaultAnalysis = standardSnapshot
                ? getSnapshotAnalysis(standardSnapshot)
                : null;

              if (!defaultAnalysis || !standardSnapshot) {
                // reset if fails
                setValue?.(value);
                return;
              }

              const newSettings: ExperimentSnapshotAnalysisSettings = {
                ...defaultAnalysis.settings,
                // get other analysis settings from current analysis
                differenceType:
                  analysis?.settings?.differenceType ?? "relative",
                baselineVariationIndex:
                  analysis?.settings?.baselineVariationIndex ?? 0,
                dimensions: [v],
              };
              // Returns success if analysis is updated or already exists
              triggerAnalysisUpdate(
                newSettings,
                defaultAnalysis,
                standardSnapshot,
                apiCall,
                setPostLoading,
              )
                .then((status) => {
                  if (status === "success") {
                    // On success, set the dimension in the dropdown to
                    // the requested value
                    setValue?.(v);

                    // also reset the snapshot dimension to the default
                    // and set the analysis settings to get the right analysis
                    // so that the snapshot provider can get the right analysis
                    setSnapshotDimension?.("");
                    setAnalysisSettings?.(newSettings);
                    track("Experiment Analysis: switch precomputed-dimension", {
                      dimension: v,
                    });
                    mutate?.();
                  }
                })
                .catch(() => {
                  // if the analysis fails, reset dropdown to the current value
                  // and do nothing
                  setValue?.(value);
                });
            } else {
              // if the dimension is not precomputed, set the dropdown to the
              // desired value and reset other selectors
              setValue?.(v, true);
              // and set the snapshot for the snapshot provider and get the
              // default analysis from that snapshot
              setSnapshotDimension?.(v);
              setAnalysisSettings?.(null);
            }
            setPostLoading(false);
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
