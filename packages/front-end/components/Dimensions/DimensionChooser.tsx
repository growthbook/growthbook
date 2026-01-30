import React, { useCallback, useEffect, useState } from "react";
import {
  ExperimentSnapshotAnalysis,
  ExperimentSnapshotAnalysisSettings,
  ExperimentSnapshotInterface,
} from "shared/types/experiment-snapshot";
import { Flex, Text } from "@radix-ui/themes";
import { getSnapshotAnalysis } from "shared/src/util";
import { DataSourceInterfaceWithParams } from "shared/types/datasource";
import { DimensionInterface } from "shared/types/dimension";
import { IncrementalRefreshInterface } from "shared/validators";
import { PiCaretDownFill } from "react-icons/pi";
import { getExposureQuery } from "@/services/datasources";
import { useDefinitions } from "@/services/DefinitionsContext";
import SelectField, { GroupedValue } from "@/components/Forms/SelectField";
import { SSRPolyfills } from "@/hooks/useSSRPolyfills";
import { useIncrementalRefresh } from "@/hooks/useIncrementalRefresh";
import { analysisUpdate } from "@/services/snapshots";
import { useAuth } from "@/services/auth";
import track from "@/services/track";
import LoadingSpinner from "@/components/LoadingSpinner";
import { useSnapshot } from "@/components/Experiment/SnapshotProvider";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/ui/DropdownMenu";
import Link from "@/ui/Link";

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
  incrementalRefresh,
  precomputedDimensions,
  datasource,
  dimensions,
  activationMetric,
  exposureQueryId,
  userIdType,
}: {
  incrementalRefresh: IncrementalRefreshInterface | null;
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
        // skip experiment dimensions that are not in the incremental refresh model
        if (
          incrementalRefresh &&
          !incrementalRefresh.unitsDimensions.includes(d)
        ) {
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
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const { dimensions, getDatasourceById, getDimensionById } = useDefinitions();
  const { dimensionless: standardSnapshot, experiment } = useSnapshot();
  const datasource = datasourceId ? getDatasourceById(datasourceId) : null;

  const { incrementalRefresh } = useIncrementalRefresh(experiment?.id ?? "");
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
    incrementalRefresh,
    precomputedDimensions,
    exposureQueryId,
    userIdType,
    datasource,
    dimensions,
    activationMetric,
  });

  const getDimensionDisplayName = (dimValue: string): string => {
    if (!dimValue) return "None";
    return (
      ssrPolyfills?.getDimensionById?.(dimValue)?.name ||
      getDimensionById(dimValue)?.name ||
      (dimValue === "pre:date" ? "Date Cohorts (First Exposure)" : "") ||
      (dimValue === "pre:activation" ? "Activation status" : "") ||
      dimValue?.split(":")?.[1] ||
      "None"
    );
  };

  const handleDimensionChange = useCallback(
    async (v: string) => {
      if (v === value) return;
      setPostLoading(true);
      try {
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
            differenceType: analysis?.settings?.differenceType ?? "relative",
            baselineVariationIndex:
              analysis?.settings?.baselineVariationIndex ?? 0,
            dimensions: [v],
          };

          // check if the analysis exists in the current snapshot
          const analysisExistsInMainSnapshot = snapshot
            ? getSnapshotAnalysis(snapshot, newSettings) !== null
            : false;
          const status = await triggerAnalysisUpdate(
            newSettings,
            defaultAnalysis,
            standardSnapshot,
            apiCall,
            setPostLoading,
          );

          if (status === "success") {
            // On success, set the dimension in the dropdown to
            // the requested value
            setValue?.(v);
            track("Experiment Analysis: switch precomputed-dimension", {
              dimension: v,
            });
            // Reset the snapshot dimension to empty (precomputed dimensions
            // use the dimensionless snapshot) and set the analysis settings
            setSnapshotDimension?.("");
            // NB: await to ensure new analysis is available before we attempt to get it
            if (!analysisExistsInMainSnapshot) await mutate?.();
            setAnalysisSettings?.(newSettings);
          } else {
            // if the analysis fails, reset dropdown to the current value
            setValue?.(value);
          }
        } else {
          // if the dimension is not precomputed, set the dropdown to the
          // desired value and reset other selectors
          setValue?.(v, true);
          // and set the snapshot for the snapshot provider and get the
          // default analysis from that snapshot
          setSnapshotDimension?.(v);
          setAnalysisSettings?.(null);
        }
      } finally {
        setPostLoading(false);
      }
    },
    [
      value,
      setValue,
      precomputedDimensions,
      standardSnapshot,
      analysis,
      triggerAnalysisUpdate,
      apiCall,
      setSnapshotDimension,
      setAnalysisSettings,
      mutate,
    ],
  );

  if (disabled) {
    const dimensionName = getDimensionDisplayName(value);
    return (
      <div>
        <div className="uppercase-title text-muted">Dimension</div>
        <div>{dimensionName}</div>
      </div>
    );
  }

  if (!newUi) {
    return (
      <Flex direction="row" gap="2" align="center">
        <SelectField
          label="Unit Dimension"
          labelClassName={labelClassName}
          options={dimensionOptions}
          formatGroupLabel={({ label }) => (
            <div className="pt-2 pb-1 border-bottom">{label}</div>
          )}
          initialOption="None"
          value={value}
          onChange={handleDimensionChange}
          sort={false}
          helpText={
            showHelp ? "Break down results for each metric by a dimension" : ""
          }
          disabled={disabled}
        />
        {postLoading && <LoadingSpinner className="ml-1" />}
      </Flex>
    );
  }

  const currentDimensionName = getDimensionDisplayName(value);

  const renderMenuItems = () => {
    const items: React.ReactNode[] = [];
    let hasItems = false;

    dimensionOptions.forEach((group, groupIndex) => {
      if (group.options && group.options.length > 0) {
        if (hasItems) {
          items.push(<DropdownMenuSeparator key={`separator-${groupIndex}`} />);
        }
        items.push(
          <DropdownMenuLabel
            key={`label-${groupIndex}`}
            textSize="1"
            textStyle={{ textTransform: "uppercase", fontWeight: 600 }}
          >
            {group.label}
          </DropdownMenuLabel>,
        );
        group.options.forEach((option) => {
          items.push(
            <DropdownMenuItem
              key={option.value}
              onClick={async () => {
                handleDimensionChange(option.value);
                setDropdownOpen(false);
              }}
            >
              {option.label}
            </DropdownMenuItem>,
          );
        });
        hasItems = true;
      }
    });

    if (items.length > 0) {
      items.unshift(
        <DropdownMenuItem
          key="none"
          onClick={async () => {
            handleDimensionChange("");
            setDropdownOpen(false);
          }}
        >
          None
        </DropdownMenuItem>,
        <DropdownMenuSeparator key="separator-none" />,
      );
    } else {
      items.push(
        <DropdownMenuItem
          key="none"
          onClick={async () => {
            handleDimensionChange("");
            setDropdownOpen(false);
          }}
        >
          None
        </DropdownMenuItem>,
      );
    }

    return items;
  };

  return (
    <Flex direction="row" gap="2" align="center">
      <Text weight="medium">Unit Dimension:</Text>
      <DropdownMenu
        trigger={
          <Link type="button" style={{ color: "var(--color-text-high)" }}>
            <Text mr="1">{currentDimensionName}</Text>
            <PiCaretDownFill style={{ fontSize: "12px" }} />
          </Link>
        }
        open={dropdownOpen}
        onOpenChange={setDropdownOpen}
        menuPlacement="start"
        variant="soft"
      >
        <DropdownMenuGroup>{renderMenuItems()}</DropdownMenuGroup>
      </DropdownMenu>
      {postLoading && <LoadingSpinner className="ml-1" />}
    </Flex>
  );
}
