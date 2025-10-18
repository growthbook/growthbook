import { Flex, Grid, IconButton, Separator, Text } from "@radix-ui/themes";
import {
  DashboardBlockInterfaceOrData,
  DashboardBlockInterface,
  DashboardBlockType,
  pinSources,
} from "back-end/src/enterprise/validators/dashboard-block";
import React, { useContext, useEffect, useMemo, useState } from "react";
import {
  blockHasFieldOfType,
  isDifferenceType,
  isMetricSelector,
  metricSelectors,
} from "shared/enterprise";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { FactMetricInterface } from "back-end/types/fact-table";
import { isDefined, isNumber, isString, isStringArray } from "shared/util";
import { SavedQuery } from "back-end/src/validators/saved-queries";
import { PiPencilSimpleFill, PiPlus } from "react-icons/pi";
import {
  expandMetricGroups,
  createAutoSliceDataForMetric,
  createCustomSliceDataForMetric,
  dedupeSliceMetrics,
  generatePinnedSliceKey,
} from "shared/experiments";
import Button from "@/ui/Button";
import Checkbox from "@/ui/Checkbox";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import { useDefinitions } from "@/services/DefinitionsContext";
import SelectField from "@/components/Forms/SelectField";
import LoadingSpinner from "@/components/LoadingSpinner";
import useApi from "@/hooks/useApi";
import Callout from "@/ui/Callout";
import SqlExplorerModal from "@/components/SchemaBrowser/SqlExplorerModal";
import { RESULTS_TABLE_COLUMNS } from "@/components/Experiment/ResultsTable";
import { getDimensionOptions } from "@/components/Dimensions/DimensionChooser";
import MarkdownInput from "@/components/Markdown/MarkdownInput";
import MetricName from "@/components/Metrics/MetricName";
import Avatar from "@/ui/Avatar";
import { getPrecomputedDimensions } from "@/components/Experiment/SnapshotProvider";
import { BLOCK_TYPE_INFO } from "..";
import {
  useDashboardSnapshot,
  DashboardSnapshotContext,
} from "../../DashboardSnapshotProvider";
import { BlockContext } from "./types";

type RequiredField = {
  field: string;
  validation: (val: unknown) => boolean;
};
const METRIC_SELECTOR = {
  field: "metricSelector",
  validation: isMetricSelector,
};
const REQUIRED_FIELDS: {
  [k in DashboardBlockType]?: Array<RequiredField>;
} = {
  "experiment-metric": [METRIC_SELECTOR],
  "experiment-dimension": [
    {
      field: "dimensionId",
      validation: (dimId) => typeof dimId === "string" && dimId.length > 0,
    },
    METRIC_SELECTOR,
  ],
  "experiment-time-series": [METRIC_SELECTOR],
  "sql-explorer": [
    {
      field: "savedQueryId",
      validation: (sqId) => typeof sqId === "string" && sqId.length > 0,
    },
    {
      field: "dataVizConfigIndex",
      validation: (idx) => typeof idx === "number" && idx >= 0,
    },
  ],
};

const metricSelectorLabels: {
  [k in (typeof metricSelectors)[number]]: string;
} = {
  "experiment-goal": "All Goal Metrics",
  "experiment-secondary": "All Secondary Metrics",
  "experiment-guardrail": "All Guardrail Metrics",
  custom: "Custom Selection",
};

interface Props {
  experiment: ExperimentInterfaceStringDates;
  cancel: () => void;
  submit: () => void;
  block?: DashboardBlockInterfaceOrData<DashboardBlockInterface>;
  setBlock: React.Dispatch<
    DashboardBlockInterfaceOrData<DashboardBlockInterface>
  >;
}
export default function EditSingleBlock({
  experiment,
  cancel,
  submit,
  block,
  setBlock,
}: Props) {
  const {
    dimensions,
    metricGroups,
    getExperimentMetricById,
    getFactTableById,
    getDatasourceById,
  } = useDefinitions();
  const {
    data: savedQueriesData,
    mutate: mutateQuery,
    isLoading,
  } = useApi<{
    status: number;
    savedQueries: SavedQuery[];
  }>(`/saved-queries/`);

  const metricGroupMap = useMemo(
    () => new Map(metricGroups.map((group) => [group.id, group])),
    [metricGroups],
  );

  const [showSqlExplorerModal, setShowSqlExplorerModal] = useState(false);
  const [selectedMetricIdForPinning, setSelectedMetricIdForPinning] =
    useState<string>("");

  // Get snapshot and analysis data
  const { snapshot, analysis } = useDashboardSnapshot(block, setBlock);
  const { dimensionless } = useContext(DashboardSnapshotContext);

  // Generate context based on block type
  const context = useMemo((): BlockContext | undefined => {
    if (!block) return undefined;

    if (block.type === "experiment-metric") {
      if (!snapshot || !analysis) {
        return {
          type: "experiment-metric",
          sliceData: [],
        };
      }

      // Generate slice data for all metrics in the block
      const sliceData: Array<{
        value: string;
        label: string;
        sliceLevels: Array<{
          column: string;
          datatype: "string" | "boolean";
          levels: string[];
        }>;
      }> = [];

      // Get all metrics for this block
      const blockMetrics =
        block.metricIds?.map(getExperimentMetricById).filter(isDefined) || [];

      blockMetrics.forEach((metric) => {
        // Get the fact table for this metric
        const factTable = getFactTableById(
          (metric as FactMetricInterface)?.numerator?.factTableId || "",
        );

        // Generate auto slice data
        const autoSliceData = createAutoSliceDataForMetric({
          parentMetric: metric,
          factTable,
          includeOther: true,
        });

        // Generate custom slice data
        const customSliceData = createCustomSliceDataForMetric({
          metricId: metric.id,
          metricName: metric.name,
          customMetricSlices: experiment.customMetricSlices || [],
          factTable,
        });

        // Combine and dedupe
        const allSliceData = dedupeSliceMetrics([
          ...autoSliceData,
          ...customSliceData,
        ]);

        // Convert to the format expected by the UI
        allSliceData.forEach((slice) => {
          // Determine the result group for this metric
          let resultGroup: "goal" | "secondary" | "guardrail";
          if (experiment.goalMetrics.includes(metric.id)) {
            resultGroup = "goal";
          } else if (experiment.secondaryMetrics.includes(metric.id)) {
            resultGroup = "secondary";
          } else if (experiment.guardrailMetrics.includes(metric.id)) {
            resultGroup = "guardrail";
          } else {
            // Default to goal if not found in any group
            resultGroup = "goal";
          }

          // Generate the pinned key
          const pinnedKey = generatePinnedSliceKey(
            metric.id,
            slice.sliceLevels,
            resultGroup,
          );

          sliceData.push({
            value: pinnedKey,
            label: slice.name,
            sliceLevels: slice.sliceLevels.map((sl) => ({
              column: sl.column,
              datatype: sl.datatype,
              levels: sl.levels,
            })),
          });
        });
      });

      return {
        type: "experiment-metric",
        sliceData,
      };
    }

    // For other block types, return appropriate context
    return {
      type: block.type as Exclude<DashboardBlockType, "experiment-metric">,
    };
  }, [
    block,
    snapshot,
    analysis,
    experiment,
    getExperimentMetricById,
    getFactTableById,
  ]);

  const metricOptions = useMemo(() => {
    const getMetrics = (metricOrGroupIds: string[]) => {
      const metricIds = expandMetricGroups(metricOrGroupIds, metricGroups);
      return metricIds.map(getExperimentMetricById).filter(isDefined);
    };

    return [
      {
        label: "Metric Groups",
        options: [
          ...experiment.goalMetrics.filter((mId) => metricGroupMap.has(mId)),
          ...experiment.secondaryMetrics.filter((mId) =>
            metricGroupMap.has(mId),
          ),
          ...experiment.guardrailMetrics.filter((mId) =>
            metricGroupMap.has(mId),
          ),
        ]
          .map((groupId) => {
            const group = metricGroupMap.get(groupId);
            return group
              ? {
                  label: group.name,
                  value: group.id,
                  tooltip: group.description,
                }
              : undefined;
          })
          .filter(isDefined),
      },
      {
        label: "Goal Metrics",
        options: getMetrics(experiment.goalMetrics).map((metric) => {
          return {
            label: metric.name,
            value: metric.id,
            tooltip: metric.description,
          };
        }),
      },
      {
        label: "Secondary Metrics",
        options: getMetrics(experiment.secondaryMetrics).map((metric) => {
          return {
            label: metric.name,
            value: metric.id,
            tooltip: metric.description,
          };
        }),
      },
      {
        label: "Guardrail Metrics",
        options: getMetrics(experiment.guardrailMetrics).map((metric) => {
          return {
            label: metric.name,
            value: metric.id,
            tooltip: metric.description,
          };
        }),
      },
    ];
  }, [experiment, getExperimentMetricById, metricGroups, metricGroupMap]);

  // Filtered metric options based on the block's metricSelector
  const filteredMetricOptions = useMemo(() => {
    if (!blockHasFieldOfType(block, "metricSelector", isMetricSelector)) {
      return metricOptions;
    }

    const selector = block.metricSelector;

    // For custom selector, show all metrics that are in the block's metricIds
    if (
      selector === "custom" &&
      blockHasFieldOfType(block, "metricIds", isStringArray)
    ) {
      const customMetricIds = (block as { metricIds: string[] }).metricIds;
      return metricOptions
        .map((group) => ({
          ...group,
          options: group.options.filter((option) =>
            customMetricIds.includes(option.value),
          ),
        }))
        .filter((group) => group.options.length > 0);
    }

    // For specific selectors, filter to only show metrics from that category
    if (selector === "experiment-goal") {
      return metricOptions.filter(
        (group) =>
          group.label === "Goal Metrics" || group.label === "Metric Groups",
      );
    }
    if (selector === "experiment-secondary") {
      return metricOptions.filter(
        (group) =>
          group.label === "Secondary Metrics" ||
          group.label === "Metric Groups",
      );
    }
    if (selector === "experiment-guardrail") {
      return metricOptions.filter(
        (group) =>
          group.label === "Guardrail Metrics" ||
          group.label === "Metric Groups",
      );
    }

    return metricOptions;
  }, [metricOptions, block]);

  // Reset selectedMetricIdForPinning if it's no longer allowed by the current metricSelector
  useEffect(() => {
    if (!selectedMetricIdForPinning) return;
    if (!blockHasFieldOfType(block, "metricSelector", isMetricSelector)) return;

    const selector = block.metricSelector;
    let isAllowed = false;

    // Check if the selected metric is allowed by the current selector
    if (
      selector === "custom" &&
      blockHasFieldOfType(block, "metricIds", isStringArray)
    ) {
      isAllowed = (block as { metricIds: string[] }).metricIds.includes(
        selectedMetricIdForPinning,
      );
    } else if (selector === "experiment-goal") {
      isAllowed =
        experiment.goalMetrics.includes(selectedMetricIdForPinning) ||
        experiment.goalMetrics.some(
          (mId) =>
            metricGroupMap.has(mId) &&
            metricGroupMap
              .get(mId)
              ?.metrics?.includes(selectedMetricIdForPinning),
        );
    } else if (selector === "experiment-secondary") {
      isAllowed =
        experiment.secondaryMetrics.includes(selectedMetricIdForPinning) ||
        experiment.secondaryMetrics.some(
          (mId) =>
            metricGroupMap.has(mId) &&
            metricGroupMap
              .get(mId)
              ?.metrics?.includes(selectedMetricIdForPinning),
        );
    } else if (selector === "experiment-guardrail") {
      isAllowed =
        experiment.guardrailMetrics.includes(selectedMetricIdForPinning) ||
        experiment.guardrailMetrics.some(
          (mId) =>
            metricGroupMap.has(mId) &&
            metricGroupMap
              .get(mId)
              ?.metrics?.includes(selectedMetricIdForPinning),
        );
    }

    if (!isAllowed) {
      setSelectedMetricIdForPinning("");
    }
  }, [block, selectedMetricIdForPinning, experiment, metricGroupMap]);

  // Helper functions for custom pin selection
  const getSliceOptions = () => {
    if (!selectedMetricIdForPinning) return [];

    // Check if we have experiment-metric context with slice data
    if (!context || context.type !== "experiment-metric") {
      return [];
    }

    // Filter slice data for the selected metric
    const metricSliceData = context.sliceData.filter((slice) => {
      // Extract metric ID from the pinned key (format: metricId?slice_querystring&location=location)
      const metricId = slice.value.split("?")[0];
      return metricId === selectedMetricIdForPinning;
    });

    return metricSliceData;
  };

  const isSlicePinned = (pinKey: string) => {
    if (!block) return false;

    const pinnedSlices =
      (block as { pinnedMetricSlices?: string[] }).pinnedMetricSlices || [];
    return pinnedSlices.includes(pinKey);
  };

  const toggleSlicePin = (pinKey: string, checked: boolean) => {
    if (!block) return;

    const currentPinnedSlices =
      (block as { pinnedMetricSlices?: string[] }).pinnedMetricSlices || [];
    const newPinnedSlices = checked
      ? [...currentPinnedSlices, pinKey]
      : currentPinnedSlices.filter((id) => id !== pinKey);

    setBlock({
      ...block,
      pinnedMetricSlices: newPinnedSlices,
    } as typeof block);
  };

  const getSelectAllState = () => {
    if (!block) return false;

    const sliceOptions = getSliceOptions();
    const pinnedSlices =
      (block as { pinnedMetricSlices?: string[] }).pinnedMetricSlices || [];
    const pinnedCount = sliceOptions.filter((slice) =>
      pinnedSlices.includes(slice.value),
    ).length;

    if (pinnedCount === 0) return false;
    if (pinnedCount === sliceOptions.length) return true;
    return "indeterminate";
  };

  const handleSelectAll = (checked: boolean) => {
    if (!block) return;

    const sliceOptions = getSliceOptions();
    const pinKeys = sliceOptions.map((slice) => slice.value);

    setBlock({
      ...block,
      pinnedMetricSlices: checked ? pinKeys : [],
    } as typeof block);
  };

  const dimensionOptions = useMemo(() => {
    const datasource = getDatasourceById(experiment.datasource);
    return getDimensionOptions({
      precomputedDimensions: getPrecomputedDimensions(snapshot, dimensionless),
      datasource,
      dimensions,
      exposureQueryId: experiment.exposureQueryId,
      userIdType: experiment.userIdType,
      activationMetric: !!experiment.activationMetric,
    }).map((optionGroup) => ({
      label: optionGroup.label,
      // For now, remove the date cohorts time-series as the visualization isn't supported yet
      options: optionGroup.options.filter(
        (option) => option.value !== "pre:date",
      ),
    }));
  }, [experiment, dimensions, getDatasourceById, snapshot, dimensionless]);

  if (isLoading) return <LoadingSpinner />;

  const savedQueryOptions =
    savedQueriesData?.savedQueries?.map(({ id, name }) => ({
      value: id,
      label: name,
    })) || [];
  const savedQuery = blockHasFieldOfType(block, "savedQueryId", isString)
    ? savedQueriesData?.savedQueries?.find(
        (q: SavedQuery) => q.id === block.savedQueryId,
      )
    : undefined;

  const requireBaselineVariation = [
    "experiment-metric",
    "experiment-dimension",
    "experiment-time-series",
  ].includes(block?.type || "");
  const baselineIndex = blockHasFieldOfType(block, "baselineRow", isNumber)
    ? block.baselineRow
    : 0;
  const baselineVariation =
    experiment.variations.find((_, i) => i === baselineIndex) ||
    experiment.variations[0];
  const variationOptions = (
    requireBaselineVariation
      ? experiment.variations.filter((_, i) => i !== baselineIndex)
      : experiment.variations
  ).map((variation) => ({
    label: variation.name,
    value: variation.id,
  }));
  const setVariations = (
    block: Extract<
      DashboardBlockInterfaceOrData<DashboardBlockInterface>,
      { variationIds: string[] }
    >,
    value: string[],
  ) => {
    setBlock({
      ...block,
      variationIds:
        requireBaselineVariation && value.length > 0
          ? [...value, baselineVariation.id]
          : value,
    });
  };

  return (
    <>
      {showSqlExplorerModal && (
        <SqlExplorerModal
          close={() => {
            setShowSqlExplorerModal(false);
          }}
          mutate={mutateQuery}
          initial={savedQuery}
          id={savedQuery?.id}
        />
      )}
      {block && (
        <Flex direction="column" py="5" px="4" gap="2" width="100%">
          <span>
            <Text weight="medium" size="4">
              <Avatar
                radius="small"
                color="indigo"
                variant="soft"
                mr="2"
                size="sm"
              >
                {BLOCK_TYPE_INFO[block.type].icon}
              </Avatar>
              {BLOCK_TYPE_INFO[block.type].name}
            </Text>
          </span>
          <Flex gap="4" direction="column" flexGrow="1">
            {block.type === "experiment-metadata" && (
              <>
                <Text weight="medium">Experiment Info</Text>
                <Grid columns="2">
                  <Checkbox
                    size="sm"
                    value={
                      [
                        block.showDescription,
                        block.showHypothesis,
                        block.showVariationImages,
                      ].some((val) => val === true)
                        ? [
                            block.showDescription,
                            block.showHypothesis,
                            block.showVariationImages,
                          ].some((val) => val === false)
                          ? "indeterminate"
                          : true
                        : false
                    }
                    setValue={(value) => {
                      setBlock({
                        ...block,
                        showDescription: value,
                        showHypothesis: value,
                        showVariationImages: value,
                        variationIds: value ? [] : undefined,
                      });
                    }}
                    label="Select All"
                  />
                  <Checkbox
                    size="sm"
                    value={block.showDescription}
                    setValue={(value) => {
                      setBlock({ ...block, showDescription: value });
                    }}
                    label={<Text weight="regular">Description</Text>}
                  />
                  <Checkbox
                    size="sm"
                    value={block.showHypothesis}
                    setValue={(value) => {
                      setBlock({ ...block, showHypothesis: value });
                    }}
                    label={<Text weight="regular">Hypothesis</Text>}
                  />
                  <Checkbox
                    size="sm"
                    value={block.showVariationImages}
                    setValue={(value) => {
                      setBlock({
                        ...block,
                        showVariationImages: value,
                        variationIds: value ? [] : undefined,
                      });
                    }}
                    label={<Text weight="regular">Variation Info</Text>}
                  />
                </Grid>
              </>
            )}
            {block.type === "experiment-traffic" && (
              <>
                <Text weight="medium">Traffic Visualizations</Text>
                <Grid columns="2">
                  <Checkbox
                    size="sm"
                    value={block.showTable}
                    setValue={(value) => {
                      setBlock({ ...block, showTable: value });
                    }}
                    label={<Text weight="regular">Show Table</Text>}
                  />
                  <Checkbox
                    size="sm"
                    value={block.showTimeseries}
                    setValue={(value) => {
                      setBlock({ ...block, showTimeseries: value });
                    }}
                    label={<Text weight="regular">Show Timeseries</Text>}
                  />
                </Grid>
              </>
            )}
            {/* Unused since no blocks currently allow a single metric */}
            {/* {blockHasFieldOfType(block, "metricId", isString) && (
              <SelectField
                label="Metric"
                labelClassName="font-weight-bold"
                value={block.metricId}
                containerClassName="mb-0"
                onChange={(value) => {
                  setBlock({ ...block, metricId: value });
                }}
                // Can't select metric groups for a single metric block
                options={metricOptions.filter(
                  ({ label }) => label !== "Metric Groups",
                )}
                formatOptionLabel={({ value }, { context }) => (
                  <MetricName
                    id={value}
                    showDescription={context !== "value"}
                    isGroup={false}
                  />
                )}
              />
            )} */}
            {blockHasFieldOfType(block, "metricSelector", isMetricSelector) && (
              <>
                <SelectField
                  required
                  markRequired
                  label="Metrics"
                  labelClassName="font-weight-bold"
                  value={block.metricSelector}
                  containerClassName="mb-0"
                  onChange={(value) =>
                    setBlock({
                      ...block,
                      metricSelector: value as (typeof metricSelectors)[number],
                    })
                  }
                  options={metricSelectors.map((selector) => ({
                    value: selector,
                    label: metricSelectorLabels[selector],
                  }))}
                  sort={false}
                  autoFocus
                />
                {block.metricSelector.includes("custom") && (
                  <MultiSelectField
                    required
                    markRequired
                    label="Custom Metric Selection"
                    labelClassName="font-weight-bold"
                    value={block.metricIds ?? []}
                    containerClassName="mb-0"
                    onChange={(value) =>
                      setBlock({ ...block, metricIds: value })
                    }
                    options={metricOptions}
                    sort={false}
                    formatOptionLabel={({ value }, { context }) => {
                      const metricGroup = metricGroupMap.get(value);
                      const metricsWithJoinableStatus = metricGroup
                        ? metricGroup.metrics
                            .map((m) => {
                              const metric = getExperimentMetricById(m);
                              return metric
                                ? {
                                    metric,
                                    joinable: true,
                                  }
                                : undefined;
                            })
                            .filter(isDefined)
                        : undefined;
                      return (
                        <MetricName
                          id={value}
                          showDescription={context !== "value"}
                          isGroup={!!metricGroup}
                          metrics={metricsWithJoinableStatus}
                        />
                      );
                    }}
                  />
                )}
              </>
            )}
            {blockHasFieldOfType(block, "dimensionId", isString) && (
              <SelectField
                required
                markRequired
                label="Dimension"
                labelClassName="font-weight-bold"
                placeholder="Choose which dimension to use"
                value={block.dimensionId}
                containerClassName="mb-0"
                onChange={(value) => setBlock({ ...block, dimensionId: value })}
                options={dimensionOptions}
                sort={false}
              />
            )}
            {blockHasFieldOfType(block, "differenceType", isDifferenceType) && (
              <>
                <SelectField
                  label="Difference Type"
                  labelClassName="font-weight-bold"
                  containerClassName="mb-0"
                  value={block.differenceType}
                  onChange={(value) =>
                    setBlock({
                      ...block,
                      differenceType: isDifferenceType(value)
                        ? value
                        : "absolute",
                    })
                  }
                  options={[
                    { label: "Relative", value: "relative" },
                    { label: "Absolute", value: "absolute" },
                    { label: "Scaled", value: "scaled" },
                  ]}
                  sort={false}
                />
                <Separator style={{ width: "100%" }} />
              </>
            )}
            {blockHasFieldOfType(block, "baselineRow", isNumber) && (
              <SelectField
                sort={false}
                label="Baseline"
                containerClassName="mb-0"
                value={block.baselineRow.toString()}
                onChange={(value) =>
                  setBlock({ ...block, baselineRow: parseInt(value) })
                }
                options={experiment.variations.map((variation, i) => ({
                  label: variation.name,
                  value: i.toString(),
                }))}
                formatOptionLabel={({ value, label }) => (
                  <div
                    className={`variation variation${value} with-variation-label d-flex align-items-center`}
                  >
                    <span
                      className="label"
                      style={{ width: 20, height: 20, flex: "none" }}
                    >
                      {value}
                    </span>
                    <span
                      className="d-inline-block"
                      style={{
                        width: 150,
                        lineHeight: "14px",
                      }}
                    >
                      {label}
                    </span>
                  </div>
                )}
              />
            )}
            {blockHasFieldOfType(block, "variationIds", isStringArray) && (
              <MultiSelectField
                sort={false}
                label="Variations"
                placeholder="Showing all variations"
                value={block.variationIds}
                containerClassName="mb-0"
                onChange={(value) => setVariations(block, value)}
                disabled={variationOptions.length < 2}
                options={variationOptions}
                formatOptionLabel={({ value, label }) => {
                  const varIndex = experiment.variations.findIndex(
                    ({ id }) => id === value,
                  );
                  return (
                    <div
                      className={`variation variation${varIndex} with-variation-label d-flex align-items-center`}
                    >
                      <span
                        className="label"
                        style={{ width: 20, height: 20, flex: "none" }}
                      >
                        {varIndex}
                      </span>
                      <span
                        className="d-inline-block"
                        style={{
                          width: 150,
                          lineHeight: "14px",
                        }}
                      >
                        {label}
                      </span>
                    </div>
                  );
                }}
              />
            )}
            {blockHasFieldOfType(block, "pinSource", isString) && (
              <SelectField
                label="Pin slice rows"
                containerClassName="mb-2"
                value={
                  (block as { pinSource?: string }).pinSource || "experiment"
                }
                onChange={(value) =>
                  setBlock({
                    ...block,
                    pinSource: value as (typeof pinSources)[number],
                    // Reset pinnedMetricSlices when switching to experiment or none
                    pinnedMetricSlices:
                      value === "custom"
                        ? (block as { pinnedMetricSlices?: string[] })
                            .pinnedMetricSlices || []
                        : [],
                  })
                }
                options={pinSources.map((source) => ({
                  value: source,
                  label:
                    source === "experiment"
                      ? "Use Experiment"
                      : source === "custom"
                        ? "Custom"
                        : "None",
                }))}
                sort={false}
              />
            )}
            {blockHasFieldOfType(block, "pinSource", isString) &&
              (block as { pinSource?: string }).pinSource === "custom" &&
              context?.type === "experiment-metric" && (
                <div className="border rounded mb-2">
                  <div className="px-3 pt-2 pb-1 border-bottom">
                    <Text weight="medium">Custom Pin Selection</Text>

                    <SelectField
                      key={block.metricSelector} // Force re-render when metricSelector changes
                      label="Select Metric"
                      containerClassName="mt-3"
                      value={selectedMetricIdForPinning || ""}
                      onChange={(value) => setSelectedMetricIdForPinning(value)}
                      options={filteredMetricOptions}
                      sort={false}
                    />
                  </div>
                  {selectedMetricIdForPinning ? (
                    <div
                      className="p-3"
                      style={{ maxHeight: 200, overflowY: "auto" }}
                    >
                      {getSliceOptions().length > 0 ? (
                        <>
                          <Checkbox
                            label="Select All"
                            value={getSelectAllState()}
                            setValue={handleSelectAll}
                            size="sm"
                            mb="4"
                          />
                          <Flex direction="column" gap="0.5">
                            {getSliceOptions().map((slice) => {
                              // Generate label from column + level pairs
                              const labelParts = slice.sliceLevels.map((sl) => {
                                if (sl.datatype === "boolean") {
                                  const value =
                                    sl.levels.length === 0
                                      ? "null"
                                      : sl.levels[0] === "true"
                                        ? "true"
                                        : "false";
                                  return (
                                    <span key={sl.column}>
                                      {sl.column}:{" "}
                                      <span
                                        style={{
                                          fontVariant: "small-caps",
                                          fontWeight: 600,
                                          fontSize: "16px",
                                        }}
                                      >
                                        {value}
                                      </span>
                                    </span>
                                  );
                                } else {
                                  const value =
                                    sl.levels.length === 0
                                      ? "other"
                                      : sl.levels[0];
                                  return `${sl.column}: ${value}`;
                                }
                              });

                              const label =
                                labelParts.length === 1
                                  ? labelParts[0]
                                  : labelParts.reduce((acc, curr, index) => {
                                      if (index === 0) return acc;
                                      return (
                                        <span key={index}>
                                          {acc} + {curr}
                                        </span>
                                      );
                                    });

                              return (
                                <Checkbox
                                  key={slice.value}
                                  label={label}
                                  value={isSlicePinned(slice.value)}
                                  setValue={(checked) =>
                                    toggleSlicePin(slice.value, checked)
                                  }
                                  size="sm"
                                  weight="regular"
                                />
                              );
                            })}
                          </Flex>
                        </>
                      ) : (
                        <Text weight="regular">
                          No slices available for this metric
                        </Text>
                      )}
                    </div>
                  ) : null}
                </div>
              )}
            {blockHasFieldOfType(block, "dimensionValues", isStringArray) && (
              <MultiSelectField
                label="Dimension Values"
                placeholder="Showing all values"
                value={block.dimensionValues}
                containerClassName="mb-0"
                onChange={(value) =>
                  setBlock({ ...block, dimensionValues: value })
                }
                options={dimensionOptions}
              />
            )}
            {blockHasFieldOfType(block, "columnsFilter", isStringArray) && (
              <>
                <Text weight="medium">Columns</Text>
                <Grid columns="2">
                  <Checkbox
                    size="sm"
                    value={
                      block.columnsFilter.length === 0 ||
                      block.columnsFilter.length ===
                        RESULTS_TABLE_COLUMNS.length
                        ? true
                        : "indeterminate"
                    }
                    setValue={() => {
                      setBlock({
                        ...block,
                        columnsFilter: [],
                      });
                    }}
                    label="Select All"
                  />
                  {RESULTS_TABLE_COLUMNS.map((colName) => (
                    <Checkbox
                      key={colName}
                      size="sm"
                      value={
                        block.columnsFilter.length === 0 ||
                        block.columnsFilter.includes(colName)
                      }
                      label={<Text weight="regular">{colName}</Text>}
                      setValue={(value) =>
                        setBlock({
                          ...block,
                          columnsFilter: value
                            ? block.columnsFilter.concat([colName])
                            : block.columnsFilter.length === 0
                              ? RESULTS_TABLE_COLUMNS.filter(
                                  (col) => col !== colName,
                                )
                              : block.columnsFilter.filter(
                                  (el) => el !== colName,
                                ),
                        })
                      }
                    />
                  ))}
                </Grid>
              </>
            )}
            {block.type === "markdown" && (
              <div style={{ flexGrow: 1 }}>
                <label className="font-weight-bold">Content</label>
                <MarkdownInput
                  hidePreview
                  value={block.content}
                  setValue={(value) => setBlock({ ...block, content: value })}
                  autofocus
                />
              </div>
            )}
            {block.type === "sql-explorer" &&
              (!savedQueriesData?.savedQueries ? (
                <Callout status="error">
                  Failed to load saved queries, try again later
                </Callout>
              ) : (
                <>
                  <SelectField
                    required
                    label={
                      <Flex justify="between" align="center">
                        <Text weight="bold">
                          Saved Query
                          <span className="text-danger ml-1">*</span>
                        </Text>
                        <IconButton
                          onClick={() => setShowSqlExplorerModal(true)}
                          variant="soft"
                          size="1"
                        >
                          {savedQuery ? <PiPencilSimpleFill /> : <PiPlus />}
                        </IconButton>
                      </Flex>
                    }
                    labelClassName="flex-grow-1"
                    containerClassName="mb-0"
                    value={block.savedQueryId}
                    placeholder="Choose a saved query"
                    options={savedQueryOptions}
                    onChange={(val) =>
                      setBlock({
                        ...block,
                        savedQueryId: val,
                        dataVizConfigIndex: -1,
                      })
                    }
                    isClearable
                    autoFocus
                  />

                  <SelectField
                    required
                    markRequired
                    label="Data Visualization"
                    labelClassName="font-weight-bold"
                    containerClassName="mb-0"
                    forceUndefinedValueToNull
                    value={block.dataVizConfigIndex.toString()}
                    placeholder={
                      (savedQuery?.dataVizConfig || []).length === 0
                        ? "No data visualizations"
                        : "Choose a data visualization to display"
                    }
                    disabled={(savedQuery?.dataVizConfig?.length || 0) === 0}
                    options={(savedQuery?.dataVizConfig || []).map(
                      ({ title }, i) => ({
                        label: title || `Visualization ${i}`,
                        value: i.toString(),
                      }),
                    )}
                    onChange={(value) =>
                      setBlock({
                        ...block,
                        dataVizConfigIndex: parseInt(value),
                      })
                    }
                  />
                </>
              ))}
          </Flex>
          <Flex gap="3" align="center" justify="center">
            <Button
              style={{ flexBasis: "45%", flexGrow: 1 }}
              variant="outline"
              color="red"
              onClick={() => {
                cancel();
              }}
            >
              Cancel
            </Button>
            <Button
              style={{ flexBasis: "45%", flexGrow: 1 }}
              onClick={() => {
                submit();
              }}
              disabled={
                !!(REQUIRED_FIELDS[block.type] || []).find(
                  ({ field, validation }) => !validation(block[field]),
                )
              }
            >
              Save & Close
            </Button>
          </Flex>
        </Flex>
      )}
    </>
  );
}
