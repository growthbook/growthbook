import { Box, Flex, Grid, IconButton, Separator, Text } from "@radix-ui/themes";
import {
  DashboardBlockInterfaceOrData,
  DashboardBlockInterface,
  DashboardBlockType,
  blockHasFieldOfType,
  isDifferenceType,
  isMetricSelector,
  metricSelectors,
  BLOCK_CONFIG_ITEM_TYPES,
  pinSources,
} from "shared/enterprise";
import React, { useContext, useEffect, useMemo, useState } from "react";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { isDefined, isNumber, isString, isStringArray } from "shared/util";
import { SavedQuery } from "shared/validators";
import {
  PiCopySimple,
  PiPencilSimpleFill,
  PiPushPinFill,
  PiTrashSimpleFill,
} from "react-icons/pi";
import { expandMetricGroups } from "shared/experiments";
import { UNSUPPORTED_METRIC_EXPLORER_TYPES } from "shared/constants";
import Button from "@/ui/Button";
import Checkbox from "@/ui/Checkbox";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import { useDefinitions } from "@/services/DefinitionsContext";
import SelectField from "@/components/Forms/SelectField";
import LoadingSpinner from "@/components/LoadingSpinner";
import useApi from "@/hooks/useApi";
import SqlExplorerModal, {
  SqlExplorerModalInitial,
} from "@/components/SchemaBrowser/SqlExplorerModal";
import { RESULTS_TABLE_COLUMNS } from "@/components/Experiment/ResultsTable";
import { getDimensionOptions } from "@/components/Dimensions/DimensionChooser";
import MarkdownInput from "@/components/Markdown/MarkdownInput";
import MetricName from "@/components/Metrics/MetricName";
import Avatar from "@/ui/Avatar";
import { getPrecomputedDimensions } from "@/components/Experiment/SnapshotProvider";
import RadioGroup from "@/ui/RadioGroup";
import Callout from "@/ui/Callout";
import { useIncrementalRefresh } from "@/hooks/useIncrementalRefresh";
import Modal from "@/components/Modal";
import { useAuth } from "@/services/auth";
import { BLOCK_TYPE_INFO } from "..";
import {
  useDashboardSnapshot,
  DashboardSnapshotContext,
} from "../../DashboardSnapshotProvider";
import MetricExplorerSettings from "./MetricExplorerSettings";
import {
  ExperimentMetricBlockContext,
  ExperimentTimeSeriesBlockContext,
} from "./types";
import { useBlockContext } from "./useBlockContext";

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
  projects: string[];
  dashboardId: string;
  experiment: ExperimentInterfaceStringDates | null;
  cancel: () => void;
  submit: () => void;
  block?: DashboardBlockInterfaceOrData<DashboardBlockInterface>;
  setBlock: React.Dispatch<
    DashboardBlockInterfaceOrData<DashboardBlockInterface>
  >;
}

function isBlockConfigItemSelected(
  blockConfig: string[] | undefined,
  itemId: string,
): boolean {
  return !!blockConfig?.includes(itemId);
}

function toggleBlockConfigItem(
  block: DashboardBlockInterfaceOrData<DashboardBlockInterface>,
  setBlock: React.Dispatch<
    DashboardBlockInterfaceOrData<DashboardBlockInterface>
  >,
  itemId: string,
  value: boolean,
) {
  // Only handle blockConfig for sql-explorer blocks
  if (block.type !== "sql-explorer") return;

  // Type guard to ensure we have a sql-explorer block with blockConfig
  if (!("blockConfig" in block)) return;

  const currentBlockConfig = block.blockConfig;
  // Remove dataVizConfigIndex from legacy blocks so the new config format takes effect
  const { dataVizConfigIndex: _, ...blockToSet } = block;

  if (value) {
    // Add item to blockConfig
    const newBlockConfig = [...currentBlockConfig, itemId];
    setBlock({
      ...blockToSet,
      blockConfig: newBlockConfig,
    });
  } else {
    // Remove item from blockConfig
    const filteredBlockConfig = currentBlockConfig.filter(
      (id: string) => id !== itemId,
    );
    setBlock({
      ...blockToSet,
      blockConfig: filteredBlockConfig,
    });
  }
}

export default function EditSingleBlock({
  dashboardId,
  experiment,
  cancel,
  submit,
  block,
  setBlock,
  projects,
}: Props) {
  const {
    dimensions,
    metricGroups,
    getExperimentMetricById,
    getDatasourceById,
    factMetrics,
  } = useDefinitions();
  const { apiCall } = useAuth();
  const {
    data: savedQueriesData,
    mutate: mutateQueries,
    isLoading,
  } = useApi<{
    status: number;
    savedQueries: SavedQuery[];
  }>(`/saved-queries/`);
  const [sqlExplorerType, setSqlExplorerType] = useState<"existing" | "create">(
    "existing",
  );

  const metricGroupMap = useMemo(
    () => new Map(metricGroups.map((group) => [group.id, group])),
    [metricGroups],
  );

  const [sqlExplorerModalProps, setSqlExplorerModalProps] = useState<
    { initial?: SqlExplorerModalInitial; savedQueryId?: string } | undefined
  >(undefined);
  const [
    showDeleteSavedQueryConfirmation,
    setShowDeleteSavedQueryConfirmation,
  ] = useState(false);
  const [selectedMetricIdForPinning, setSelectedMetricIdForPinning] =
    useState<string>("");

  const { analysis } = useDashboardSnapshot(block, setBlock);
  const { defaultSnapshot, dimensionless, updateAllSnapshots } = useContext(
    DashboardSnapshotContext,
  );

  const { incrementalRefresh } = useIncrementalRefresh(experiment?.id ?? "");

  // Get block context from workspace level
  const blockId = blockHasFieldOfType(block, "id", isString) ? block.id : null;
  const blockContext = useBlockContext(blockId);

  // TODO: does this need to handle metric groups
  const factMetricOptions = useMemo(() => {
    return factMetrics
      .filter((factMetric) => {
        // Always include the existing fact metric. This will prevent issues if the fact metric or the dashboard's projects have changed since the block was created.
        if (
          blockHasFieldOfType(block, "factMetricId", isString) &&
          factMetric.id === block.factMetricId
        ) {
          return true;
        }

        if (UNSUPPORTED_METRIC_EXPLORER_TYPES.includes(factMetric.metricType)) {
          return false;
        }

        // Filter fact metrics to only include those that are in 'All Projects' or have all of the projects in the projects list
        if (!projects.length || !factMetric.projects.length) {
          return true;
        }

        return projects.every((project) =>
          factMetric.projects.includes(project),
        );
      })
      .map((m) => ({ label: m.name, value: m.id }));
  }, [block, factMetrics, projects]);

  const metricOptions = useMemo(() => {
    // For general dashboards without experiment, return empty options
    if (!experiment) {
      return [];
    }

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
    if (selector === "custom") {
      const customMetricIds = expandMetricGroups(
        block.metricIds ?? [],
        metricGroups,
      );
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
      return metricOptions.filter((group) => group.label === "Goal Metrics");
    }
    if (selector === "experiment-secondary") {
      return metricOptions.filter(
        (group) => group.label === "Secondary Metrics",
      );
    }
    if (selector === "experiment-guardrail") {
      return metricOptions.filter(
        (group) => group.label === "Guardrail Metrics",
      );
    }

    return metricOptions;
  }, [metricOptions, block, metricGroups]);

  // Reset selectedMetricIdForPinning if it's no longer allowed by the current metricSelector
  useEffect(() => {
    if (!selectedMetricIdForPinning) return;
    if (!blockHasFieldOfType(block, "metricSelector", isMetricSelector)) return;

    const selector = block.metricSelector;
    let isAllowed = false;

    // Check if the selected metric is allowed by the current selector
    if (experiment) {
      if (selector === "custom") {
        isAllowed = expandMetricGroups(
          block.metricIds ?? [],
          metricGroups,
        ).includes(selectedMetricIdForPinning);
      } else if (selector === "experiment-goal") {
        isAllowed = expandMetricGroups(
          experiment.goalMetrics,
          metricGroups,
        ).includes(selectedMetricIdForPinning);
      } else if (selector === "experiment-secondary") {
        isAllowed = expandMetricGroups(
          experiment.secondaryMetrics,
          metricGroups,
        ).includes(selectedMetricIdForPinning);
      } else if (selector === "experiment-guardrail") {
        isAllowed = expandMetricGroups(
          experiment.guardrailMetrics,
          metricGroups,
        ).includes(selectedMetricIdForPinning);
      }
    }

    if (!isAllowed) {
      setSelectedMetricIdForPinning("");
    }
  }, [block, selectedMetricIdForPinning, experiment, metricGroups]);

  const getSliceOptions = (metricId: string) => {
    if (!metricId) return [];

    // If we have context with sliceData, use it
    if (
      blockContext &&
      "sliceData" in blockContext &&
      Array.isArray(blockContext.sliceData)
    ) {
      // Filter slice data for the selected metric
      const metricSliceData = (
        blockContext as
          | ExperimentMetricBlockContext
          | ExperimentTimeSeriesBlockContext
      ).sliceData.filter((slice) => {
        // Extract metric ID from the pinned key (format: metricId?slice_querystring&location=location)
        const sliceMetricId = slice.value.split("?")[0];
        return sliceMetricId === metricId;
      });
      return metricSliceData;
    }

    return [];
  };

  const isSlicePinned = (pinKey: string) => {
    if (!block) return false;

    // If we have context with isSlicePinned function, use it
    if (
      blockContext &&
      "isSlicePinned" in blockContext &&
      typeof blockContext.isSlicePinned === "function"
    ) {
      return blockContext.isSlicePinned(pinKey) || false;
    }

    return false;
  };

  const toggleSlicePin = (pinKey: string, checked: boolean) => {
    if (
      !block ||
      !blockHasFieldOfType(block, "pinnedMetricSlices", isStringArray)
    )
      return;

    const newPinnedSlices = checked
      ? [...block.pinnedMetricSlices, pinKey]
      : block.pinnedMetricSlices.filter((id) => id !== pinKey);

    setBlock({
      ...block,
      pinnedMetricSlices: newPinnedSlices,
    } as typeof block);
  };

  const getSelectAllState = () => {
    if (
      !block ||
      !blockHasFieldOfType(block, "pinnedMetricSlices", isStringArray)
    )
      return false;

    const sliceOptions = getSliceOptions(selectedMetricIdForPinning);
    const pinnedCount = sliceOptions.filter((slice) =>
      block.pinnedMetricSlices.includes(slice.value),
    ).length;

    if (pinnedCount === 0) return false;
    if (pinnedCount === sliceOptions.length) return true;
    return "indeterminate";
  };

  const handleSelectAll = (checked: boolean) => {
    if (!block) return;

    const sliceOptions = getSliceOptions(selectedMetricIdForPinning);
    const pinKeys = sliceOptions.map((slice) => slice.value);

    setBlock({
      ...block,
      pinnedMetricSlices: checked ? pinKeys : [],
    } as typeof block);
  };

  const dimensionOptions = useMemo(() => {
    // For general dashboards without experiment, return empty options
    if (!experiment) {
      return [];
    }

    const datasource = getDatasourceById(experiment.datasource);
    return getDimensionOptions({
      incrementalRefresh,
      precomputedDimensions: getPrecomputedDimensions(
        defaultSnapshot,
        dimensionless,
      ),
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
  }, [
    experiment,
    dimensions,
    getDatasourceById,
    defaultSnapshot,
    dimensionless,
    incrementalRefresh,
  ]);

  const savedQueryId = blockHasFieldOfType(block, "savedQueryId", isString)
    ? block.savedQueryId
    : undefined;

  const savedQueryOptions = useMemo(
    () =>
      savedQueriesData?.savedQueries
        ?.filter((savedQuery) => {
          return (
            savedQuery.linkedDashboardIds?.includes(dashboardId) ||
            savedQueryId === savedQuery.id
          );
        })
        .map(({ id, name }) => ({
          value: id,
          label: name,
        })) || [],
    [savedQueriesData?.savedQueries, dashboardId, savedQueryId],
  );

  useEffect(() => {
    if (
      block?.type === "sql-explorer" &&
      sqlExplorerType === "existing" &&
      !savedQueryOptions.length &&
      !savedQueryId
    ) {
      setSqlExplorerType("create");
      setSqlExplorerModalProps({});
    }
  }, [block?.type, savedQueryId, savedQueryOptions.length, sqlExplorerType]);

  const dimensionValueOptions = analysis?.results
    ? analysis.results.map(({ name }) => ({ value: name, label: name }))
    : [];

  if (isLoading) return <LoadingSpinner />;

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
  // Only compute baseline/variation options when the block type depends on an experiment
  const hasExperimentContext = !!experiment && requireBaselineVariation;
  const baselineVariation = hasExperimentContext
    ? experiment.variations.find((_, i) => i === baselineIndex) ||
      experiment.variations[0]
    : null;
  const variationOptions = hasExperimentContext
    ? (requireBaselineVariation
        ? experiment.variations.filter((_, i) => i !== baselineIndex)
        : experiment.variations
      ).map((variation) => ({ label: variation.name, value: variation.id }))
    : [];
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
        requireBaselineVariation && value.length > 0 && baselineVariation?.id
          ? [...value, baselineVariation.id]
          : value,
    });
  };

  return (
    <>
      {savedQuery && showDeleteSavedQueryConfirmation && (
        <Modal
          trackingEventModalType=""
          header={"Delete Saved Query?"}
          close={() => setShowDeleteSavedQueryConfirmation(false)}
          open={true}
          cta="Delete"
          submitColor="danger"
          submit={async () => {
            await apiCall(`/saved-queries/${savedQuery.id}`, {
              method: "DELETE",
            });
            if (blockHasFieldOfType(block, "savedQueryId", isString)) {
              setBlock({ ...block, savedQueryId: "" });
            }
            mutateQueries();
          }}
          increasedElevation={true}
        >
          Are you sure? This action cannot be undone.
        </Modal>
      )}
      {sqlExplorerModalProps && (
        <SqlExplorerModal
          close={() => {
            setSqlExplorerModalProps(undefined);
          }}
          mutate={mutateQueries}
          initial={sqlExplorerModalProps.initial}
          projects={projects}
          id={sqlExplorerModalProps.savedQueryId}
          dashboardId={dashboardId}
          onSave={async ({
            savedQueryId,
            name,
            newVisualizationIds,
            allVisualizationIds,
          }) => {
            if (!block || block.type !== "sql-explorer" || !savedQueryId)
              return;

            // Start with existing block config
            let newBlockConfig = [...(block.blockConfig || [])];

            // No visualizations: always show results table
            if (allVisualizationIds.length === 0) {
              newBlockConfig = [BLOCK_CONFIG_ITEM_TYPES.RESULTS_TABLE];
            } else {
              // Add all new visualizations to existing block config
              newBlockConfig.push(...newVisualizationIds);

              // Filter out any visualizations that no longer exist
              newBlockConfig = newBlockConfig.filter((itemId) => {
                if (itemId === BLOCK_CONFIG_ITEM_TYPES.RESULTS_TABLE) {
                  return true;
                }
                return allVisualizationIds.includes(itemId);
              });

              // Remove duplicates (this should never happen, but just in case)
              newBlockConfig = Array.from(new Set(newBlockConfig));
            }

            setBlock({
              ...block,
              savedQueryId,
              title: name || "SQL Query",
              blockConfig: newBlockConfig,
            });
            setSqlExplorerType("existing");
            await mutateQueries();
            await updateAllSnapshots();
          }}
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
            {blockHasFieldOfType(block, "factMetricId", isString) && (
              <SelectField
                label={
                  <Text as="label" size="3" weight="medium">
                    Metric
                  </Text>
                }
                labelClassName="mb-0"
                value={block.factMetricId}
                containerClassName="mb-0"
                onChange={(value) => {
                  const isMetricExplorer = block.type === "metric-explorer";
                  setBlock({
                    ...block,
                    title:
                      factMetricOptions.find((option) => option.value === value)
                        ?.label || "Metric",
                    factMetricId: value,
                    ...(isMetricExplorer && {
                      metricAnalysisId: "",
                      analysisSettings: (() => {
                        const {
                          additionalNumeratorFilters:
                            _additionalNumeratorFilters,
                          additionalDenominatorFilters:
                            _additionalDenominatorFilters,
                          ...restSettings
                        } = block.analysisSettings;
                        return {
                          ...restSettings,
                          populationId: "",
                          populationType: "factTable",
                          userIdType: "",
                        };
                      })(),
                    }),
                  });
                }}
                options={factMetricOptions}
                formatOptionLabel={({ value }, { context }) => (
                  <MetricName
                    id={value}
                    showDescription={context !== "value"}
                    isGroup={false}
                  />
                )}
              />
            )}
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
                options={
                  experiment
                    ? experiment.variations.map((variation, i) => ({
                        label: variation.name,
                        value: i.toString(),
                      }))
                    : []
                }
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
                  const varIndex = experiment
                    ? experiment.variations.findIndex(({ id }) => id === value)
                    : -1;
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
            {blockHasFieldOfType(block, "pinSource", isString) ? (
              <SelectField
                label="Pin slice rows"
                containerClassName="mb-2"
                value={block.pinSource || "experiment"}
                onChange={(value) =>
                  setBlock({
                    ...block,
                    pinSource: value as (typeof pinSources)[number],
                    // Reset pinnedMetricSlices when switching to experiment or none
                    pinnedMetricSlices:
                      value === "custom" ? block.pinnedMetricSlices || [] : [],
                  } as DashboardBlockInterface & { pinSource: string })
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
            ) : null}
            {blockHasFieldOfType(block, "pinSource", isString) &&
              block.pinSource === "custom" && (
                <div className="border rounded mb-2">
                  <div className="px-3 pt-2 pb-1 border-bottom">
                    <PiPushPinFill className="mr-1" style={{ marginTop: -2 }} />
                    <Text weight="medium">Custom Pin Selection</Text>

                    <SelectField
                      label="Select Metric"
                      containerClassName="mt-3"
                      value={selectedMetricIdForPinning || ""}
                      onChange={(value) => setSelectedMetricIdForPinning(value)}
                      options={filteredMetricOptions}
                      sort={false}
                      formatOptionLabel={({ label, value }) => (
                        <Flex align="center" justify="between" gap="3">
                          <Box
                            flexGrow="1"
                            overflow="hidden"
                            style={{ textOverflow: "ellipsis" }}
                          >
                            <Text>{label}</Text>
                          </Box>
                          <Box flexShrink="0">
                            <Text size="1" color="gray">
                              {
                                getSliceOptions(value)
                                  .map((slice) => isSlicePinned(slice.value))
                                  .filter(Boolean).length
                              }{" "}
                              of {getSliceOptions(value).length} pinned
                            </Text>
                          </Box>
                        </Flex>
                      )}
                    />
                  </div>
                  {selectedMetricIdForPinning ? (
                    <div
                      className="p-3"
                      style={{ maxHeight: 200, overflowY: "auto" }}
                    >
                      {getSliceOptions(selectedMetricIdForPinning).length >
                      0 ? (
                        <>
                          <Checkbox
                            label="Select All"
                            value={getSelectAllState()}
                            setValue={handleSelectAll}
                            size="sm"
                            mb="4"
                          />
                          <Flex direction="column" gap="0.5">
                            {getSliceOptions(selectedMetricIdForPinning).map(
                              (slice) => {
                                // Generate label from column + level pairs
                                const labelParts = slice.sliceLevels.map(
                                  (sl) => {
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
                                  },
                                );

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
                              },
                            )}
                          </Flex>
                        </>
                      ) : (
                        <Text
                          weight="regular"
                          color="gray"
                          as="p"
                          mx="4"
                          my="2"
                        >
                          No slices available for this metric
                        </Text>
                      )}
                    </div>
                  ) : (
                    <Text weight="regular" color="gray" as="p" mx="4" my="2">
                      No metric selected
                    </Text>
                  )}
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
                options={dimensionValueOptions}
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
            {block.type === "sql-explorer" && (
              <Flex direction="column" gap="2" width="100%" my="3">
                {!block.savedQueryId ? (
                  <RadioGroup
                    value={sqlExplorerType}
                    setValue={(value: "create" | "existing") => {
                      // Reset the saved query id if the type changes
                      setBlock({
                        ...block,
                        savedQueryId: "",
                      });
                      setSqlExplorerType(value);
                    }}
                    options={[
                      {
                        label: "Select existing query",
                        value: "existing",
                        disabled: !savedQueryOptions.length,
                      },
                      {
                        label: "Create new query",
                        value: "create",
                      },
                    ]}
                  />
                ) : null}

                {sqlExplorerType === "create" ? (
                  <Button
                    variant="soft"
                    onClick={() => setSqlExplorerModalProps({})}
                  >
                    <span className="w-100">
                      <PiPencilSimpleFill /> Create query
                    </span>
                  </Button>
                ) : (
                  <>
                    <SelectField
                      required
                      labelClassName="flex-grow-1"
                      containerClassName="mb-0"
                      value={savedQuery?.id || ""}
                      forceUndefinedValueToNull
                      placeholder="Choose a saved query"
                      label={
                        <Flex justify="between" align="center">
                          <Text weight="bold">Saved Query</Text>
                          <Flex align="center" gap="1">
                            <IconButton
                              disabled={!savedQuery}
                              variant="soft"
                              size="1"
                              onClick={() =>
                                setShowDeleteSavedQueryConfirmation(true)
                              }
                            >
                              <PiTrashSimpleFill />
                            </IconButton>
                            <IconButton
                              disabled={!savedQuery}
                              variant="soft"
                              size="1"
                              onClick={() =>
                                setSqlExplorerModalProps({
                                  initial: savedQuery,
                                })
                              }
                            >
                              <PiCopySimple />
                            </IconButton>

                            <IconButton
                              disabled={!savedQuery}
                              variant="soft"
                              size="1"
                              onClick={() =>
                                setSqlExplorerModalProps({
                                  initial: savedQuery,
                                  savedQueryId: savedQuery?.id,
                                })
                              }
                            >
                              <PiPencilSimpleFill />
                            </IconButton>
                          </Flex>
                        </Flex>
                      }
                      options={savedQueryOptions}
                      onChange={(val) => {
                        setBlock({
                          ...block,
                          title:
                            savedQueryOptions.find(
                              (option) => option.value === val,
                            )?.label || "SQL Query",
                          savedQueryId: val,
                          blockConfig: [],
                        });
                      }}
                      isClearable
                    />
                  </>
                )}
                {savedQuery ? (
                  <>
                    {savedQuery?.results.error ? (
                      <Callout status="error">
                        <p>
                          There is an error with your query. Click the pencil
                          icon to edit.
                        </p>
                        <strong>Error:</strong> {savedQuery?.results.error}
                      </Callout>
                    ) : (
                      <>
                        <Separator size="4" my="4" />
                        <Flex direction="column" gap="2">
                          <Text
                            size="1"
                            style={{ color: "var(--color-text-mid)" }}
                            weight="medium"
                            className="text-uppercase"
                          >
                            Customize Display
                          </Text>
                          {savedQuery?.dataVizConfig?.map((config, index) => {
                            const title =
                              config.title || `Visualization ${index + 1}`;
                            const configId = config.id || title; // Fallback to title for backward compatibility
                            return (
                              <Checkbox
                                key={index}
                                label={title}
                                size="md"
                                value={isBlockConfigItemSelected(
                                  block.blockConfig,
                                  configId,
                                )}
                                setValue={(value) =>
                                  toggleBlockConfigItem(
                                    block,
                                    setBlock,
                                    configId,
                                    value,
                                  )
                                }
                              />
                            );
                          })}
                          <Checkbox
                            key="results-table"
                            label="Query results table"
                            size="md"
                            value={isBlockConfigItemSelected(
                              block.blockConfig,
                              BLOCK_CONFIG_ITEM_TYPES.RESULTS_TABLE,
                            )}
                            setValue={(value) =>
                              toggleBlockConfigItem(
                                block,
                                setBlock,
                                BLOCK_CONFIG_ITEM_TYPES.RESULTS_TABLE,
                                value,
                              )
                            }
                          />
                        </Flex>
                      </>
                    )}
                  </>
                ) : null}
              </Flex>
            )}
            {block.type === "metric-explorer" && (
              <MetricExplorerSettings block={block} setBlock={setBlock} />
            )}
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
