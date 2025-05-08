import { Flex, IconButton, Text } from "@radix-ui/themes";
import {
  DashboardBlockInterfaceOrData,
  DashboardBlockInterface,
  DimensionBlockInterface,
  DashboardBlockType,
} from "back-end/src/enterprise/validators/dashboard-block";
import React, { useMemo, useState } from "react";
import clsx from "clsx";
import { blockHasFieldOfType, isDifferenceType } from "shared/enterprise";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { isDefined } from "shared/util";
import { SavedQuery } from "back-end/src/validators/saved-queries";
import { PiPencil, PiPlus } from "react-icons/pi";
import { isNumber, isString, isStringArray } from "back-end/src/util/types";
import { useSidebarOpen } from "@/components/Layout/SidebarOpenProvider";
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
import Field from "@/components/Forms/Field";
import MarkdownInput from "@/components/Markdown/MarkdownInput";
import { useDashboardSnapshot } from "../DashboardSnapshotProvider";
import { BLOCK_TYPE_INFO } from ".";

const DRAWER_MAX_HEIGHT = 330;

type RequiredField<
  BType extends DashboardBlockType,
  BInterface extends Extract<DashboardBlockInterface, { type: BType }>
> = {
  field: keyof BInterface;
  validation: (val: BInterface[keyof BInterface]) => boolean;
};
const REQUIRED_FIELDS: {
  [k in DashboardBlockType]?: Array<
    RequiredField<k, Extract<DashboardBlockInterface, { type: k }>>
  >;
} = {
  metric: [
    {
      field: "metricIds",
      validation: (metIds) => isStringArray(metIds) && metIds.length > 0,
    },
  ],
  dimension: [
    {
      field: "dimensionId",
      validation: (dimId) => typeof dimId === "string" && dimId.length > 0,
    },
    {
      field: "metricIds",
      validation: (metIds) => isStringArray(metIds) && metIds.length > 0,
    },
  ],
  "time-series": [
    {
      field: "metricId",
      validation: (metId) => typeof metId === "string" && metId.length > 0,
    },
  ],
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

interface Props {
  experiment: ExperimentInterfaceStringDates;
  open: boolean;
  cancel: () => void;
  submit: () => void;
  block?: DashboardBlockInterfaceOrData<DashboardBlockInterface>;
  setBlock: React.Dispatch<
    DashboardBlockInterfaceOrData<DashboardBlockInterface>
  >;
}
export default function DashboardBlockEditDrawer({
  experiment,
  open,
  cancel,
  submit,
  block,
  setBlock,
}: Props) {
  const { open: sidebarOpen } = useSidebarOpen();
  const {
    getMetricById,
    getFactMetricById,
    dimensions,
    getDatasourceById,
  } = useDefinitions();
  const { data: savedQueriesData, mutate: mutateQuery, isLoading } = useApi<{
    status: number;
    savedQueries: SavedQuery[];
  }>(`/saved-queries/`);

  const { snapshot, analysis } = useDashboardSnapshot(block, setBlock);

  const dimensionValueOptions =
    snapshot?.dimension && analysis?.results
      ? analysis.results.map(({ name }) => ({ value: name, label: name }))
      : [];

  const [showSqlExplorerModal, setShowSqlExplorerModal] = useState(false);

  const metricOptions = useMemo(
    () => [
      {
        label: "Goal Metrics",
        options: experiment.goalMetrics
          .map((mId) => {
            const metric = getMetricById(mId) || getFactMetricById(mId);
            return metric ? { label: metric.name, value: mId } : undefined;
          })
          .filter(isDefined),
      },
      {
        label: "Secondary Metrics",
        options: experiment.secondaryMetrics
          .map((mId) => {
            const metric = getMetricById(mId) || getFactMetricById(mId);
            return metric ? { label: metric.name, value: mId } : undefined;
          })
          .filter(isDefined),
      },
      {
        label: "Guardrail Metrics",
        options: experiment.guardrailMetrics
          .map((mId) => {
            const metric = getMetricById(mId) || getFactMetricById(mId);
            return metric ? { label: metric.name, value: mId } : undefined;
          })
          .filter(isDefined),
      },
    ],
    [experiment, getMetricById, getFactMetricById]
  );

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
        (option) => option.value !== "pre:date"
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
        (q: SavedQuery) => q.id === block.savedQueryId
      )
    : undefined;

  const requireBaselineVariation = [
    "metric",
    "dimension",
    "time-series",
  ].includes(block?.type || "");
  const baselineIndex = blockHasFieldOfType(block, "baselineRow", isNumber)
    ? block.baselineRow
    : 0;
  const baselineVariation =
    experiment.variations.find((_, i) => i === baselineIndex) ||
    experiment.variations[0];
  const variationOptions = (requireBaselineVariation
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
    value: string[]
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
    <div
      id="edit-drawer"
      className={clsx("sidebarLeft", {
        sidebarLeftOpen: sidebarOpen,
        sidebarLeftClosed: !sidebarOpen,
      })}
      style={{
        display: "flex",
        transition: "all 0.5s cubic-bezier(0.685, 0.0473, 0.346, 1)",
        boxShadow:
          "0px 12px 32px -16px var(--slate-a3), 0px 8px 40px 0px var(--black-a1), 0px 0px 0px 1px var(--slate-a3)",
        position: "fixed",
        bottom: 0,
        right: 0,
        maxHeight: open ? `${DRAWER_MAX_HEIGHT}px` : "0px",
        minHeight: open ? "200px" : "0px",
        background: "white",
        zIndex: 9001,
        paddingBottom: "32px",
      }}
    >
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
        <Flex direction="column" py="5" px="4" gap="2" flexGrow="1">
          <Flex justify="between" align="center" px="2">
            <span>
              <Text weight="light">{BLOCK_TYPE_INFO[block.type].name}</Text>
              {block.title && <Text weight="medium"> / {block.title}</Text>}
            </span>
            <Flex gap="4">
              <Button
                variant="ghost"
                onClick={() => {
                  cancel();
                }}
                size="xs"
              >
                Cancel
              </Button>
              <Button
                onClick={() => {
                  submit();
                }}
                size="xs"
                disabled={
                  !!(REQUIRED_FIELDS[block.type] || []).find(
                    ({ field, validation }) => !validation(block[field])
                  )
                }
              >
                Save & Close
              </Button>
            </Flex>
          </Flex>
          <Flex
            wrap="wrap"
            gap="4"
            overflow="scroll"
            px="2"
            pb="2"
            flexGrow="1"
            style={{
              borderBottom: "1px solid var(--slate-a6)",
            }}
          >
            <Field
              label="Title"
              labelClassName="font-weight-bold"
              containerStyle={{ flexBasis: "32%" }}
              containerClassName="mb-0"
              placeholder={BLOCK_TYPE_INFO[block.type].name}
              value={block.title}
              onChange={(e) => setBlock({ ...block, title: e.target.value })}
            />
            <Field
              label="Description"
              labelClassName="font-weight-bold"
              containerStyle={{ flexBasis: "60%", flexGrow: 1 }}
              containerClassName="mb-0"
              placeholder="Add a description"
              value={block.description}
              onChange={(e) =>
                setBlock({ ...block, description: e.target.value })
              }
              textarea
              minRows={1}
              maxRows={1}
            />

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
            {blockHasFieldOfType(block, "metricId", isString) && (
              <SelectField
                label="Metric"
                labelClassName="font-weight-bold"
                value={block.metricId}
                containerStyle={{ flexBasis: "32%" }}
                containerClassName="mb-0"
                onChange={(value) => setBlock({ ...block, metricId: value })}
                options={metricOptions}
              />
            )}
            {blockHasFieldOfType(block, "metricIds", isStringArray) && (
              <MultiSelectField
                required
                markRequired
                label="Metrics"
                labelClassName="font-weight-bold"
                value={block.metricIds}
                containerStyle={{ flexBasis: "32%", flexGrow: 1 }}
                containerClassName="mb-0"
                onChange={(value) => setBlock({ ...block, metricIds: value })}
                options={metricOptions}
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
                    ({ id }) => id === value
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
                    differenceType: value as DimensionBlockInterface["differenceType"],
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
                      typeof RESULTS_TABLE_COLUMNS[number]
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
                          {savedQuery ? <PiPencil /> : <PiPlus />}
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

                  {savedQuery && (
                    <SelectField
                      required
                      markRequired
                      label="Data Visualization"
                      labelClassName="font-weight-bold"
                      containerStyle={{ flexBasis: "32%" }}
                      containerClassName="mb-0"
                      value={block.dataVizConfigIndex.toString()}
                      placeholder={
                        (savedQuery.dataVizConfig || []).length === 0
                          ? "No data visualizations"
                          : "Choose a data visualization to display"
                      }
                      disabled={(savedQuery.dataVizConfig?.length || 0) === 0}
                      options={(savedQuery.dataVizConfig || []).map(
                        ({ title }, i) => ({
                          label: title || `Visualization ${i}`,
                          value: i.toString(),
                        })
                      )}
                      onChange={(value) =>
                        setBlock({
                          ...block,
                          dataVizConfigIndex: parseInt(value),
                        })
                      }
                    />
                  )}
                </>
              ))}
          </Flex>
        </Flex>
      )}
    </div>
  );
}
