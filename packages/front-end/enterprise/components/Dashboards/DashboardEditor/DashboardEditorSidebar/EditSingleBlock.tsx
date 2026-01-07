import {
  Flex,
  Grid,
  IconButton,
  Separator,
  Text,
  Box,
  Heading,
} from "@radix-ui/themes";
import {
  DashboardBlockInterfaceOrData,
  DashboardBlockInterface,
  DashboardBlockType,
  blockHasFieldOfType,
  isDifferenceType,
  isMetricSelector,
  metricSelectors,
  BLOCK_CONFIG_ITEM_TYPES,
  filterMetricsBySelector,
} from "shared/enterprise";
import React, { useContext, useEffect, useMemo, useState } from "react";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { isNumber, isString, isStringArray } from "shared/util";
import { SavedQuery } from "shared/validators";
import {
  PiCopySimple,
  PiPencilSimpleFill,
  PiTrashSimpleFill,
} from "react-icons/pi";
import { UNSUPPORTED_METRIC_EXPLORER_TYPES } from "shared/constants";
import { FormatOptionLabelMeta } from "react-select";
import {
  getAvailableMetricsFilters,
  getAvailableSliceTags,
  getAvailableMetricTags,
} from "@/services/experiments";
import {
  getMetricOptions,
  getSliceOptions,
  formatSliceOptionLabel,
  formatMetricTagOptionLabel,
  formatMetricOptionLabel,
} from "@/components/Experiment/ResultsMetricFilter";
import Button from "@/ui/Button";
import Checkbox from "@/ui/Checkbox";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import { useDefinitions } from "@/services/DefinitionsContext";
import SelectField, { SingleValue } from "@/components/Forms/SelectField";
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
  all: "All Metrics",
  "experiment-goal": "All Goal Metrics",
  "experiment-secondary": "All Secondary Metrics",
  "experiment-guardrail": "All Guardrail Metrics",
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
    getMetricGroupById,
    getDatasourceById,
    getFactTableById,
    factMetrics,
    factTables,
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

  const [sqlExplorerModalProps, setSqlExplorerModalProps] = useState<
    { initial?: SqlExplorerModalInitial; savedQueryId?: string } | undefined
  >(undefined);
  const [
    showDeleteSavedQueryConfirmation,
    setShowDeleteSavedQueryConfirmation,
  ] = useState(false);

  const { analysis } = useDashboardSnapshot(block, setBlock);
  const { defaultSnapshot, dimensionless, updateAllSnapshots } = useContext(
    DashboardSnapshotContext,
  );

  const { incrementalRefresh } = useIncrementalRefresh(experiment?.id ?? "");

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

  // Extract available metrics and groups for filtering, filtered by metricSelector
  const availableMetricsFilters = useMemo(() => {
    if (!experiment) {
      return { groups: [], metrics: [] };
    }

    // Filter input metrics based on metricSelector before calling getAvailableMetricsFilters
    const selector = blockHasFieldOfType(
      block,
      "metricSelector",
      isMetricSelector,
    )
      ? block.metricSelector
      : "all";
    const { goalMetrics, secondaryMetrics, guardrailMetrics } =
      filterMetricsBySelector({
        goalMetrics: experiment.goalMetrics,
        secondaryMetrics: experiment.secondaryMetrics,
        guardrailMetrics: experiment.guardrailMetrics,
        metricSelector: selector,
      });

    return getAvailableMetricsFilters({
      goalMetrics,
      secondaryMetrics,
      guardrailMetrics,
      metricGroups,
      getExperimentMetricById,
    });
  }, [experiment, metricGroups, getExperimentMetricById, block]);

  // Generate metric options
  const metricOptions = useMemo(() => {
    const blockMetricIds =
      block && "metricIds" in block ? block.metricIds || [] : [];
    return getMetricOptions({
      availableMetricsFilters,
      selectedMetricIds: blockMetricIds,
    });
  }, [availableMetricsFilters, block]);

  // Generate available slice tags for blocks that support slice filtering
  const availableSliceTags = useMemo(() => {
    if (!experiment) return [];
    if (!blockHasFieldOfType(block, "metricSelector", isMetricSelector)) {
      return [];
    }

    // Filter input metrics based on metricSelector
    const selector = blockHasFieldOfType(
      block,
      "metricSelector",
      isMetricSelector,
    )
      ? block.metricSelector
      : "all";
    const { goalMetrics, secondaryMetrics, guardrailMetrics } =
      filterMetricsBySelector({
        goalMetrics: experiment.goalMetrics,
        secondaryMetrics: experiment.secondaryMetrics,
        guardrailMetrics: experiment.guardrailMetrics,
        metricSelector: selector,
      });

    return getAvailableSliceTags({
      goalMetrics,
      secondaryMetrics,
      guardrailMetrics,
      customMetricSlices: experiment.customMetricSlices,
      metricGroups,
      factTables,
      getExperimentMetricById,
      getFactTableById,
    });
  }, [
    experiment,
    metricGroups,
    factTables,
    getExperimentMetricById,
    getFactTableById,
    block,
  ]);

  // Generate available metric tags for blocks that support metric tag filtering
  const availableMetricTags = useMemo(() => {
    if (!experiment) return [];
    if (!blockHasFieldOfType(block, "metricSelector", isMetricSelector)) {
      return [];
    }

    // Filter input metrics based on metricSelector
    const selector = blockHasFieldOfType(
      block,
      "metricSelector",
      isMetricSelector,
    )
      ? block.metricSelector
      : "all";
    const { goalMetrics, secondaryMetrics, guardrailMetrics } =
      filterMetricsBySelector({
        goalMetrics: experiment.goalMetrics,
        secondaryMetrics: experiment.secondaryMetrics,
        guardrailMetrics: experiment.guardrailMetrics,
        metricSelector: selector,
      });

    return getAvailableMetricTags({
      goalMetrics,
      secondaryMetrics,
      guardrailMetrics,
      metricGroups,
      getExperimentMetricById,
    });
  }, [experiment, metricGroups, getExperimentMetricById, block]);

  // Generate metric tag options
  const metricTagOptions = useMemo(() => {
    const blockMetricTagFilter =
      block && "metricTagFilter" in block ? block.metricTagFilter || [] : [];
    const availableTagSet = new Set(availableMetricTags);
    const allTagIds = Array.from(
      new Set([...availableMetricTags, ...blockMetricTagFilter]),
    );

    return allTagIds.map((tag) => ({
      value: tag,
      label: tag,
      isOrphaned: !availableTagSet.has(tag),
    }));
  }, [availableMetricTags, block]);

  // Generate slice options
  const sliceOptions = useMemo(() => {
    const blockSliceTagsFilter =
      block && "sliceTagsFilter" in block ? block.sliceTagsFilter : [];
    return getSliceOptions({
      availableSliceTags,
      sliceTagsFilter: blockSliceTagsFilter,
    });
  }, [availableSliceTags, block]);

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
                <Box px="3" pt="3" mb="2" className="bg-highlight rounded">
                  <Heading size="2" weight="bold" mb="3">
                    Filters
                  </Heading>
                  <MultiSelectField
                    label="Metrics"
                    labelClassName="font-weight-bold"
                    value={block.metricIds ?? []}
                    onChange={(value) =>
                      setBlock({ ...block, metricIds: value })
                    }
                    options={[
                      ...(metricOptions.groups.length > 0
                        ? [
                            {
                              label: "Metric Groups",
                              options: metricOptions.groups.map((group) => ({
                                label: group.name,
                                value: group.id,
                                isOrphaned: group.isOrphaned,
                              })),
                            },
                          ]
                        : []),
                      ...(metricOptions.metrics.length > 0
                        ? [
                            {
                              label: "Metrics",
                              options: metricOptions.metrics.map((metric) => ({
                                label: metric.name,
                                value: metric.id,
                                isOrphaned: metric.isOrphaned,
                              })),
                            },
                          ]
                        : []),
                    ]}
                    sort={false}
                    formatOptionLabel={(
                      option: SingleValue & { isOrphaned?: boolean },
                      meta: FormatOptionLabelMeta<SingleValue>,
                    ) =>
                      formatMetricOptionLabel(
                        option,
                        getExperimentMetricById,
                        getMetricGroupById,
                        meta?.context !== "value",
                      )
                    }
                    formatGroupLabel={(group) => (
                      <div className="pb-1 pt-2">{group.label}</div>
                    )}
                  />
                  {blockHasFieldOfType(
                    block,
                    "metricTagFilter",
                    isStringArray,
                  ) &&
                    metricTagOptions.length > 0 && (
                      <MultiSelectField
                        label="Tags"
                        labelClassName="font-weight-bold"
                        value={block.metricTagFilter}
                        onChange={(value) =>
                          setBlock({ ...block, metricTagFilter: value })
                        }
                        options={metricTagOptions.map((tag) => ({
                          label: tag.label,
                          value: tag.value,
                          isOrphaned: tag.isOrphaned,
                        }))}
                        formatOptionLabel={(option) =>
                          formatMetricTagOptionLabel(option)
                        }
                      />
                    )}
                  {blockHasFieldOfType(
                    block,
                    "sliceTagsFilter",
                    isStringArray,
                  ) &&
                    sliceOptions.length > 0 && (
                      <MultiSelectField
                        label="Slices"
                        labelClassName="font-weight-bold"
                        value={block.sliceTagsFilter}
                        onChange={(value) =>
                          setBlock({ ...block, sliceTagsFilter: value })
                        }
                        options={sliceOptions.map(({ value, isOrphaned }) => ({
                          label: value,
                          value,
                          isOrphaned,
                        }))}
                        sort={false}
                        formatOptionLabel={(
                          option: SingleValue & { isOrphaned?: boolean },
                          meta: FormatOptionLabelMeta<SingleValue>,
                        ) => {
                          const fullOption = sliceOptions.find(
                            (o) => o.value === option.value,
                          );
                          if (!fullOption) {
                            return option.label;
                          }
                          return formatSliceOptionLabel(
                            fullOption,
                            meta,
                            block.sliceTagsFilter,
                          );
                        }}
                      />
                    )}
                </Box>
                {blockHasFieldOfType(
                  block,
                  "sortBy",
                  (val) => val === null || typeof val === "string",
                ) && (
                  <SelectField
                    label="Sort by"
                    labelClassName="font-weight-bold"
                    containerClassName="mb-2"
                    value={block.sortBy || ""}
                    onChange={(value) =>
                      setBlock({
                        ...block,
                        sortBy: (value || null) as (typeof block)["sortBy"],
                        // Clear sortDirection when switching away from significance/change
                        sortDirection:
                          value === "significance" || value === "change"
                            ? block.sortDirection
                            : null,
                      })
                    }
                    options={[
                      { value: "", label: "Default" },
                      { value: "custom", label: "Metric filter" },
                      { value: "significance", label: "Significance" },
                      { value: "change", label: "Change" },
                    ]}
                    sort={false}
                  />
                )}
                {blockHasFieldOfType(
                  block,
                  "sortDirection",
                  (val) => val === null || val === "asc" || val === "desc",
                ) &&
                  blockHasFieldOfType(
                    block,
                    "sortBy",
                    (val) => val === null || typeof val === "string",
                  ) &&
                  (block.sortBy === "significance" ||
                    block.sortBy === "change") && (
                    <SelectField
                      label="Sort direction"
                      labelClassName="font-weight-bold"
                      containerClassName="mb-2"
                      value={block.sortDirection || ""}
                      onChange={(value) =>
                        setBlock({
                          ...block,
                          sortDirection: (value ||
                            null) as (typeof block)["sortDirection"],
                        })
                      }
                      options={[
                        { value: "", label: "Default" },
                        { value: "asc", label: "Ascending" },
                        { value: "desc", label: "Descending" },
                      ]}
                      sort={false}
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
