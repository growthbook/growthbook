import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ExperimentSnapshotAnalysis,
  ExperimentSnapshotAnalysisSettings,
  ExperimentSnapshotInterface,
} from "shared/types/experiment-snapshot";
import { Flex } from "@radix-ui/themes";
import { getSnapshotAnalysis } from "shared/util";
import { DataSourceInterfaceWithParams } from "shared/types/datasource";
import { DimensionInterface } from "shared/types/dimension";
import { IncrementalRefreshInterface } from "shared/validators";
import { PiCaretDownFill } from "react-icons/pi";
import {
  COMBO_DIMENSION_LENGTH,
  buildComboDimensionId,
  buildDateCutoffDimensionId,
  isCustomDimensionId,
  parseDimensionId,
} from "shared/experiments";
import { datetime, getValidDate } from "shared/dates";
import { getExposureQuery } from "@/services/datasources";
import { useDefinitions } from "@/services/DefinitionsContext";
import SelectField, {
  GroupedValue,
  SingleValue,
} from "@/components/Forms/SelectField";
import { SSRPolyfills } from "@/hooks/useSSRPolyfills";
import { useIncrementalRefresh } from "@/hooks/useIncrementalRefresh";
import { analysisUpdate } from "@/services/snapshots";
import { useAuth } from "@/services/auth";
import track from "@/services/track";
import LoadingSpinner from "@/components/LoadingSpinner";
import { getHonoredPrecomputedUnitDimensionIds } from "@/services/experiments";
import { useUser } from "@/services/UserContext";
import { useSnapshot } from "@/components/Experiment/SnapshotProvider";
import CustomDimensionFields, {
  CustomDimensionDraft,
  CustomDimensionKind,
  isCustomDimensionDraftValid,
} from "@/components/Dimensions/CustomDimensionFields";
import CustomDimensionModal from "@/components/Dimensions/CustomDimensionModal";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/ui/DropdownMenu";
import Link from "@/ui/Link";
import Text from "@/ui/Text";

// UI-only sentinel values for the two configurable dimensions; never persisted
export const CUSTOM_CUTOFF_OPTION = "custom:cutoff";
export const CUSTOM_COMBO_OPTION = "custom:combo";

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
  enableCustomDimensions?: boolean;
  // Valid range for the "First Exposed After..." cutoff. Derived from the
  // snapshot context's experiment phase when omitted.
  cutoffBounds?: { min?: Date; max?: Date };
}

export function getCombinationConstituentOptions({
  incrementalRefresh,
  datasource,
  dimensions,
  exposureQueryId,
  userIdType,
}: {
  incrementalRefresh: IncrementalRefreshInterface | null;
  datasource: DataSourceInterfaceWithParams | null;
  dimensions: DimensionInterface[];
  exposureQueryId?: string;
  userIdType?: string;
}): SingleValue[] {
  const options: SingleValue[] = [];

  const exposureQuery = datasource?.settings
    ? getExposureQuery(datasource.settings, exposureQueryId, userIdType)
    : null;
  const experimentDimensions = exposureQuery
    ? exposureQuery.dimensions
    : (datasource?.settings?.experimentDimensions ?? []);
  experimentDimensions.forEach((d) => {
    // With incremental refresh, experiment dimensions must be materialized
    // on the units table to be usable inside a combination
    if (incrementalRefresh && !incrementalRefresh.unitsDimensions.includes(d)) {
      return;
    }
    options.push({ label: d, value: "exp:" + d });
  });

  dimensions
    .filter((d) => d.datasource === datasource?.id)
    .forEach((d) => {
      options.push({ label: d.name, value: d.id });
    });

  return options;
}

export function getDimensionOptions({
  incrementalRefresh,
  precomputedDimensions,
  precomputedUnitDimensionIds,
  hasPipelineModeFeature = false,
  datasource,
  dimensions,
  activationMetric,
  exposureQueryId,
  userIdType,
  includeCustomDimensions = false,
}: {
  incrementalRefresh: IncrementalRefreshInterface | null;
  precomputedDimensions?: string[];
  precomputedUnitDimensionIds?: string[];
  hasPipelineModeFeature?: boolean;
  datasource: DataSourceInterfaceWithParams | null;
  dimensions: DimensionInterface[];
  exposureQueryId?: string;
  userIdType?: string;
  activationMetric?: boolean;
  includeCustomDimensions?: boolean;
}): GroupedValue[] {
  // Include unit dimensions tied to the datasource
  const filteredUnitDimensions = dimensions
    .filter((d) => d.datasource === datasource?.id)
    .map((d) => ({ label: d.name, value: d.id }));

  // When displaying, we are grouping Experiment Dimensions and
  // Precomputed Unit Dimensions under 'precomputed' as they
  // are both available for free after the main refresh.
  const honoredPrecomputedUnitDimensionIds =
    getHonoredPrecomputedUnitDimensionIds(
      precomputedUnitDimensionIds,
      datasource,
      hasPipelineModeFeature,
    );
  const experimentPrecomputedUnitDimensionIds = new Set(
    honoredPrecomputedUnitDimensionIds,
  );

  // Include user dimensions tied to the datasource. Precomputed unit dims are kept
  // in a separate bucket so they can be promoted into the "Pre-computed" group.
  const unitDimensions = filteredUnitDimensions.filter(
    (d) => !experimentPrecomputedUnitDimensionIds.has(d.value),
  );
  const precomputedUnitDimensionOptions = filteredUnitDimensions.filter((d) =>
    experimentPrecomputedUnitDimensionIds.has(d.value),
  );

  const precomputedExperimentDimensionOptions =
    precomputedDimensions?.map((d) => ({
      label: d.replace("precomputed:", ""),
      value: d,
    })) ?? [];
  const precomputedDimensionOptions = [
    ...precomputedExperimentDimensionOptions,
    ...precomputedUnitDimensionOptions,
  ];

  const exposureQuery = datasource?.settings
    ? getExposureQuery(datasource.settings, exposureQueryId, userIdType)
    : null;
  // Add experiment dimensions based on the selected exposure query
  if (exposureQuery) {
    if (exposureQuery.dimensions.length > 0) {
      exposureQuery.dimensions.forEach((d) => {
        // skip pre-computed dimensions
        if (precomputedExperimentDimensionOptions.some((p) => p.label === d)) {
          return;
        }
        // skip experiment dimensions that are not in the incremental refresh model
        if (
          incrementalRefresh &&
          !incrementalRefresh.unitsDimensions.includes(d)
        ) {
          return;
        }

        unitDimensions.push({
          label: d,
          value: "exp:" + d,
        });
      });
    }
  }
  // Legacy data sources - add experiment dimensions
  else if ((datasource?.settings?.experimentDimensions?.length ?? 0) > 0) {
    datasource?.settings?.experimentDimensions?.forEach((d) => {
      unitDimensions.push({
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

  const onDemandDimensions = [...builtInDimensions, ...unitDimensions];

  if (includeCustomDimensions) {
    onDemandDimensions.push({
      label: "First Exposed After...",
      value: CUSTOM_CUTOFF_OPTION,
    });
    const constituentOptions = getCombinationConstituentOptions({
      incrementalRefresh,
      datasource,
      dimensions,
      exposureQueryId,
      userIdType,
    });
    if (constituentOptions.length >= COMBO_DIMENSION_LENGTH) {
      onDemandDimensions.push({
        label: "Combination of Dimensions...",
        value: CUSTOM_COMBO_OPTION,
      });
    }
  }

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

export function getDimensionDisplayName(
  dimValue: string,
  resolveDimensionName: (id: string) => string | undefined,
): string {
  if (!dimValue) return "None";
  const resolved = resolveDimensionName(dimValue);
  if (resolved) return resolved;
  if (dimValue === "pre:date") return "Date Cohorts (First Exposure)";
  if (dimValue === "pre:activation") return "Activation status";
  const parsed = parseDimensionId(dimValue);
  if (parsed.kind === "datecutoff") {
    return `First exposed after ${datetime(parsed.cutoff)}`;
  }
  if (parsed.kind === "combo") {
    return parsed.constituentIds
      .map((c) => {
        const constituent = parseDimensionId(c);
        return constituent.kind === "experiment"
          ? constituent.column
          : resolveDimensionName(c) || c;
      })
      .join(" & ");
  }
  return dimValue?.split(":")?.[1] || "None";
}

export function draftFromDimensionId(
  dimValue: string,
): CustomDimensionDraft | null {
  const parsed = parseDimensionId(dimValue);
  if (parsed.kind === "datecutoff") {
    return { kind: "cutoff", cutoff: parsed.cutoff, constituentIds: [] };
  }
  if (parsed.kind === "combo") {
    return { kind: "combo", constituentIds: [...parsed.constituentIds] };
  }
  return null;
}

function buildCustomDimensionId(draft: CustomDimensionDraft): string {
  return draft.kind === "cutoff" && draft.cutoff
    ? buildDateCutoffDimensionId(draft.cutoff)
    : buildComboDimensionId(draft.constituentIds);
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
  enableCustomDimensions = true,
  cutoffBounds,
}: Props) {
  const { apiCall } = useAuth();

  const [postLoading, setPostLoading] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [customModalKind, setCustomModalKind] =
    useState<CustomDimensionKind | null>(null);
  const [draftCustom, setDraftCustom] = useState<CustomDimensionDraft | null>(
    null,
  );
  const { dimensions, getDatasourceById, getDimensionById } = useDefinitions();
  const { hasCommercialFeature } = useUser();
  const {
    dimensionless: standardSnapshot,
    experiment,
    phase,
    precomputedUnitDimensionIds,
  } = useSnapshot();
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

  const hasPipelineModeFeature = hasCommercialFeature("pipeline-mode");
  const honoredPrecomputedUnitDimensionIds = useMemo(
    () =>
      getHonoredPrecomputedUnitDimensionIds(
        precomputedUnitDimensionIds,
        datasource,
        hasPipelineModeFeature,
      ),
    [precomputedUnitDimensionIds, datasource, hasPipelineModeFeature],
  );
  const precomputedAnalysisDimensions = useMemo(
    () =>
      new Set([
        ...(precomputedDimensions ?? []),
        ...honoredPrecomputedUnitDimensionIds,
      ]),
    [precomputedDimensions, honoredPrecomputedUnitDimensionIds],
  );

  const dimensionOptions = getDimensionOptions({
    incrementalRefresh,
    precomputedDimensions,
    precomputedUnitDimensionIds,
    hasPipelineModeFeature,
    exposureQueryId,
    userIdType,
    datasource,
    dimensions,
    activationMetric,
    includeCustomDimensions: enableCustomDimensions && !disabled,
  });

  const constituentOptions = useMemo(
    () =>
      getCombinationConstituentOptions({
        incrementalRefresh,
        datasource,
        dimensions,
        exposureQueryId,
        userIdType,
      }),
    [incrementalRefresh, datasource, dimensions, exposureQueryId, userIdType],
  );

  const { cutoffMin, cutoffMax } = useMemo(() => {
    if (cutoffBounds) {
      return { cutoffMin: cutoffBounds.min, cutoffMax: cutoffBounds.max };
    }
    const phaseObj = experiment?.phases?.[phase];
    if (!phaseObj) return { cutoffMin: undefined, cutoffMax: undefined };
    return {
      cutoffMin: getValidDate(phaseObj.dateStarted),
      cutoffMax: phaseObj.dateEnded
        ? getValidDate(phaseObj.dateEnded)
        : new Date(),
    };
  }, [cutoffBounds, experiment, phase]);

  const resolveDimensionName = useCallback(
    (id: string): string | undefined =>
      ssrPolyfills?.getDimensionById?.(id)?.name ||
      getDimensionById(id)?.name ||
      undefined,
    [ssrPolyfills, getDimensionById],
  );

  const displayName = (dimValue: string): string =>
    getDimensionDisplayName(dimValue, resolveDimensionName);

  const handleDimensionChange = useCallback(
    async (v: string) => {
      if (v === value) return;
      setPostLoading(true);
      try {
        setValue?.(v);
        if (precomputedAnalysisDimensions.has(v)) {
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

          const analysisExistsInMainSnapshot = standardSnapshot
            ? getSnapshotAnalysis(standardSnapshot, newSettings) !== null
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
            setAnalysisSettings?.(newSettings);
            // Reset the snapshot dimension to empty (precomputed dimensions
            // use the dimensionless snapshot) and set the analysis settings
            setSnapshotDimension?.("");
            // NB: await to ensure new analysis is available before we attempt to get it
            if (!analysisExistsInMainSnapshot) await mutate?.();
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
      precomputedAnalysisDimensions,
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
    const dimensionName = displayName(value);
    return (
      <div>
        <div className="uppercase-title text-muted">Dimension</div>
        <div>{dimensionName}</div>
      </div>
    );
  }

  const sentinelForKind = (kind: CustomDimensionKind): string =>
    kind === "cutoff" ? CUSTOM_CUTOFF_OPTION : CUSTOM_COMBO_OPTION;
  const valueDraft =
    enableCustomDimensions && isCustomDimensionId(value)
      ? draftFromDimensionId(value)
      : null;

  if (!newUi) {
    // A configured custom dimension is not among the standard options, so
    // add it for react-select to render its label
    const selectOptions =
      valueDraft && !draftCustom
        ? [
            ...dimensionOptions,
            {
              label: "Selected",
              options: [{ label: displayName(value), value }],
            },
          ]
        : dimensionOptions;
    const selectValue = draftCustom ? sentinelForKind(draftCustom.kind) : value;
    const activeDraft = draftCustom ?? valueDraft;

    const handleSelectChange = (v: string) => {
      if (v === CUSTOM_CUTOFF_OPTION || v === CUSTOM_COMBO_OPTION) {
        const kind: CustomDimensionKind =
          v === CUSTOM_CUTOFF_OPTION ? "cutoff" : "combo";
        setDraftCustom(
          valueDraft?.kind === kind ? valueDraft : { kind, constituentIds: [] },
        );
        return;
      }
      setDraftCustom(null);
      handleDimensionChange(v);
    };

    // Keep invalid drafts local; commit to the form as soon as they are valid
    const handleDraftChange = (next: CustomDimensionDraft) => {
      if (isCustomDimensionDraftValid(next, cutoffMin, cutoffMax)) {
        setDraftCustom(null);
        handleDimensionChange(buildCustomDimensionId(next));
      } else {
        setDraftCustom(next);
      }
    };

    return (
      <Flex direction="column" gap="1">
        <Flex direction="row" gap="2" align="center">
          <SelectField
            size="legacy"
            label="Unit Dimension"
            labelClassName={labelClassName}
            options={selectOptions}
            initialOption="None"
            value={selectValue}
            onChange={handleSelectChange}
            sort={false}
            helpText={
              showHelp
                ? "Break down results for each metric by a dimension"
                : ""
            }
            disabled={disabled}
          />
          {postLoading && <LoadingSpinner className="ml-1" />}
        </Flex>
        {activeDraft && (
          <CustomDimensionFields
            draft={activeDraft}
            setDraft={handleDraftChange}
            constituentOptions={constituentOptions}
            cutoffMin={cutoffMin}
            cutoffMax={cutoffMax}
          />
        )}
      </Flex>
    );
  }

  const currentDimensionName = displayName(value);

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
            textSize="sm"
            textStyle={{ textTransform: "uppercase", fontWeight: 600 }}
          >
            {group.label}
          </DropdownMenuLabel>,
        );
        group.options.forEach((option) => {
          const customKind: CustomDimensionKind | null =
            option.value === CUSTOM_CUTOFF_OPTION
              ? "cutoff"
              : option.value === CUSTOM_COMBO_OPTION
                ? "combo"
                : null;
          items.push(
            <DropdownMenuItem
              key={option.value}
              onClick={async () => {
                if (customKind) {
                  setCustomModalKind(customKind);
                } else {
                  handleDimensionChange(option.value);
                }
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
      <Text weight="semibold" color="text-high">
        Unit Dimension:
      </Text>
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
      {customModalKind && (
        <CustomDimensionModal
          initialDraft={
            valueDraft?.kind === customModalKind
              ? valueDraft
              : { kind: customModalKind, constituentIds: [] }
          }
          constituentOptions={constituentOptions}
          cutoffMin={cutoffMin}
          cutoffMax={cutoffMax}
          close={() => setCustomModalKind(null)}
          onApply={(draft) =>
            handleDimensionChange(buildCustomDimensionId(draft))
          }
        />
      )}
    </Flex>
  );
}
