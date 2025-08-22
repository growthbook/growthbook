import { Flex, Grid, IconButton, Text } from "@radix-ui/themes";
import {
  DashboardBlockInterfaceOrData,
  DashboardBlockInterface,
  DashboardBlockType,
} from "back-end/src/enterprise/validators/dashboard-block";
import React, { useMemo, useState } from "react";
import {
  blockHasFieldOfType,
  isDifferenceType,
  isMetricSelector,
  metricSelectors,
} from "shared/enterprise";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { isDefined, isNumber, isString, isStringArray } from "shared/util";
import { SavedQuery } from "back-end/src/validators/saved-queries";
import { PiPencilSimpleFill, PiPlus } from "react-icons/pi";
import { expandMetricGroups } from "shared/experiments";
import Button from "@/components/Radix/Button";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import { useDefinitions } from "@/services/DefinitionsContext";
import SelectField from "@/components/Forms/SelectField";
import LoadingSpinner from "@/components/LoadingSpinner";
import useApi from "@/hooks/useApi";
import Callout from "@/components/Radix/Callout";
import SqlExplorerModal from "@/components/SchemaBrowser/SqlExplorerModal";
import { RESULTS_TABLE_COLUMNS } from "@/components/Experiment/ResultsTable";
import { getDimensionOptions } from "@/components/Dimensions/DimensionChooser";
import MarkdownInput from "@/components/Markdown/MarkdownInput";
import MetricName from "@/components/Metrics/MetricName";
import Checkbox from "@/components/Radix/Checkbox";
import { useDashboardSnapshot } from "../../DashboardSnapshotProvider";
import { BLOCK_TYPE_INFO } from "..";

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

  const { snapshot, analysis } = useDashboardSnapshot(block, setBlock);

  const dimensionValueOptions =
    snapshot?.dimension && analysis?.results
      ? analysis.results.map(({ name }) => ({ value: name, label: name }))
      : [];

  const [showSqlExplorerModal, setShowSqlExplorerModal] = useState(false);

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

  const dimensionOptions = useMemo(() => {
    const datasource = getDatasourceById(experiment.datasource);
    return getDimensionOptions({
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
  }, [experiment, dimensions, getDatasourceById]);

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
            {/* TODO: add icon */}
            <Text weight="medium" size="4">
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
                    label="Show Description"
                  />
                  <Checkbox
                    size="sm"
                    value={block.showHypothesis}
                    setValue={(value) => {
                      setBlock({ ...block, showHypothesis: value });
                    }}
                    label="Show Hypothesis"
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
                    label="Show Variations"
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
                    label="Show Table"
                  />
                  <Checkbox
                    size="sm"
                    value={block.showTimeseries}
                    setValue={(value) => {
                      setBlock({ ...block, showTimeseries: value });
                    }}
                    label="Show Timeseries"
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
                containerStyle={{ flexBasis: "32%" }}
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
                  containerStyle={{ flexBasis: "32%" }}
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
                />
                {block.metricSelector.includes("custom") && (
                  <MultiSelectField
                    required
                    markRequired
                    label="Custom Metric Selection"
                    labelClassName="font-weight-bold"
                    value={block.metricIds ?? []}
                    containerStyle={{ flexBasis: "32%" }}
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
                containerStyle={{ flexBasis: "32%" }}
                containerClassName="mb-0"
                onChange={(value) => setBlock({ ...block, dimensionId: value })}
                options={dimensionOptions}
              />
            )}
            {blockHasFieldOfType(block, "baselineRow", isNumber) && (
              <SelectField
                sort={false}
                label="Baseline Variation"
                labelClassName="font-weight-bold"
                containerStyle={{ flexBasis: "32%" }}
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
                labelClassName="font-weight-bold"
                placeholder="Showing all variations"
                value={block.variationIds}
                containerStyle={{ flexBasis: "32%" }}
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
            {blockHasFieldOfType(block, "dimensionValues", isStringArray) && (
              <MultiSelectField
                label="Dimension Values"
                labelClassName="font-weight-bold"
                placeholder="Showing all values"
                value={block.dimensionValues}
                containerStyle={{ flexBasis: "32%" }}
                containerClassName="mb-0"
                onChange={(value) =>
                  setBlock({ ...block, dimensionValues: value })
                }
                options={dimensionValueOptions}
              />
            )}
            {blockHasFieldOfType(block, "differenceType", isDifferenceType) && (
              <SelectField
                label="Difference Type"
                labelClassName="font-weight-bold"
                containerStyle={{ flexBasis: "32%" }}
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
            )}
            {blockHasFieldOfType(block, "columnsFilter", isStringArray) && (
              <MultiSelectField
                sort={false}
                label="Display Columns"
                labelClassName="font-weight-bold"
                placeholder="Showing all columns"
                value={block.columnsFilter}
                containerStyle={{ flexBasis: "32%" }}
                containerClassName="mb-0"
                onChange={(value) =>
                  setBlock({
                    ...block,
                    columnsFilter: value as Array<
                      (typeof RESULTS_TABLE_COLUMNS)[number]
                    >,
                  })
                }
                options={RESULTS_TABLE_COLUMNS.map((colName) => ({
                  label: colName,
                  value: colName,
                }))}
              />
            )}
            {block.type === "markdown" && (
              <div style={{ flexBasis: "100%" }}>
                <label className="font-weight-bold">Content</label>
                <MarkdownInput
                  hidePreview
                  value={block.content}
                  setValue={(value) => setBlock({ ...block, content: value })}
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
                    containerStyle={{ flexBasis: "32%" }}
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
                  />

                  <SelectField
                    required
                    markRequired
                    label="Data Visualization"
                    labelClassName="font-weight-bold"
                    containerStyle={{ flexBasis: "32%" }}
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
