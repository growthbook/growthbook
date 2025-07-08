import { Flex, IconButton, Text } from "@radix-ui/themes";
import {
  DashboardBlockData,
  DashboardBlockInterface,
  DimensionBlockInterface,
} from "back-end/src/enterprise/validators/dashboard-block";
import React, { useMemo, useState } from "react";
import clsx from "clsx";
import {
  blockHasFieldOfType,
  isDifferenceType,
  isSqlExplorerBlock,
} from "shared/enterprise";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { isDefined } from "shared/util";
import { SavedQuery } from "back-end/src/validators/saved-queries";
import { PiPencil, PiPlus } from "react-icons/pi";
import { isStringArray } from "back-end/src/util/types";
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
import { BLOCK_TYPE_INFO } from ".";

interface Props {
  experiment: ExperimentInterfaceStringDates;
  open: boolean;
  cancel: () => void;
  submit: () => void;
  block?: DashboardBlockData<DashboardBlockInterface>;
  setBlock: React.Dispatch<DashboardBlockData<DashboardBlockInterface>>;
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
    metrics,
    factMetrics,
    dimensions,
    getDatasourceById,
  } = useDefinitions();
  const { data: savedQueriesData, mutate: mutateQuery, isLoading } = useApi<{
    status: number;
    savedQueries: SavedQuery[];
  }>(`/saved-queries/`);

  const [showSqlExplorerModal, setShowSqlExplorerModal] = useState(false);

  const metricOptions = useMemo(
    () =>
      metrics
        .map((m) =>
          m.datasource === experiment.datasource
            ? { label: m.name, value: m.id }
            : undefined
        )
        .concat(
          factMetrics.map((m) =>
            m.datasource === experiment.datasource
              ? { label: m.name, value: m.id }
              : undefined
          )
        )
        .filter(isDefined),
    [experiment, metrics, factMetrics]
  );

  const dimensionOptions = useMemo(() => {
    const datasource = getDatasourceById(experiment.datasource);
    return getDimensionOptions({
      datasource,
      dimensions,
      exposureQueryId: experiment.exposureQueryId,
      userIdType: experiment.userIdType,
      activationMetric: !!experiment.activationMetric,
    });
  }, [experiment, dimensions, getDatasourceById]);

  if (isLoading) return <LoadingSpinner />;

  const savedQueryOptions =
    savedQueriesData?.savedQueries?.map(({ id, name }) => ({
      value: id,
      label: name,
    })) || [];
  const savedQuery =
    block && isSqlExplorerBlock(block)
      ? savedQueriesData?.savedQueries?.find(
          (q: SavedQuery) => q.id === block.savedQueryId
        )
      : undefined;

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
        position: "fixed",
        bottom: 0,
        right: 0,
        maxHeight: open ? "330px" : "0px",
        background: "white",
        zIndex: 9001,
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
        <Flex direction="column" py="5" px="6" gap="2" flexGrow="1">
          <Flex justify="between" align="center">
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
              >
                Save & Close
              </Button>
            </Flex>
          </Flex>
          <Flex
            className="odd-children-flex-grow"
            wrap="wrap"
            gap="4"
            overflow="scroll"
          >
            {blockHasFieldOfType(
              block,
              "metricId",
              (val: unknown) => typeof val === "string"
            ) && (
              <SelectField
                label="Metric"
                labelClassName="font-weight-bold"
                value={block.metricId}
                containerStyle={{ flexBasis: "40%" }}
                containerClassName="mb-0"
                onChange={(value) => setBlock({ ...block, metricId: value })}
                options={metricOptions}
              />
            )}

            {blockHasFieldOfType(block, "metricIds", isStringArray) && (
              <MultiSelectField
                label="Metrics"
                labelClassName="font-weight-bold"
                value={block.metricIds}
                containerStyle={{ flexBasis: "40%" }}
                containerClassName="mb-0"
                onChange={(value) => setBlock({ ...block, metricIds: value })}
                options={metricOptions}
              />
            )}
            {blockHasFieldOfType(block, "columnsFilter", isStringArray) && (
              <MultiSelectField
                label="Display Columns"
                labelClassName="font-weight-bold"
                placeholder="Showing all columns"
                value={block.columnsFilter}
                containerStyle={{ flexBasis: "40%" }}
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
            {blockHasFieldOfType(
              block,
              "dimensionId",
              (val: unknown) => typeof val === "string"
            ) && (
              <SelectField
                label="Dimension"
                labelClassName="font-weight-bold"
                placeholder="Choose which dimension to use"
                value={block.dimensionId}
                containerStyle={{ flexBasis: "40%" }}
                containerClassName="mb-0"
                onChange={(value) => setBlock({ ...block, dimensionId: value })}
                options={dimensionOptions}
              />
            )}
            {blockHasFieldOfType(block, "variationIds", isStringArray) && (
              <MultiSelectField
                label="Variations"
                labelClassName="font-weight-bold"
                placeholder="Showing all variations"
                value={block.variationIds}
                containerStyle={{ flexBasis: "40%" }}
                containerClassName="mb-0"
                onChange={(value) =>
                  setBlock({ ...block, variationIds: value })
                }
                options={experiment.variations
                  .filter((_, i) => i > 0)
                  .map((variation) => ({
                    label: variation.name,
                    value: variation.id,
                  }))}
              />
            )}
            {blockHasFieldOfType(
              block,
              "baselineRow",
              (val: unknown) => typeof val === "number"
            ) && (
              <SelectField
                label="Baseline Variation"
                labelClassName="font-weight-bold"
                containerStyle={{ flexBasis: "40%" }}
                containerClassName="mb-0"
                value={block.baselineRow.toString()}
                onChange={(value) =>
                  setBlock({ ...block, baselineRow: parseInt(value) })
                }
                options={experiment.variations.map((_, i) => ({
                  label: i.toString(),
                  value: i.toString(),
                }))}
              />
            )}
            {blockHasFieldOfType(block, "differenceType", isDifferenceType) && (
              <SelectField
                label="Difference Type"
                labelClassName="font-weight-bold"
                containerStyle={{ flexBasis: "40%" }}
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
              />
            )}
            {isSqlExplorerBlock(block) &&
              (!savedQueriesData?.savedQueries ? (
                <Callout status="error">
                  Failed to load saved queries, try again later
                </Callout>
              ) : (
                <>
                  <SelectField
                    label={
                      <Flex gap="1" align="center">
                        <Text weight="bold">Saved Query</Text>
                        <IconButton
                          onClick={() => setShowSqlExplorerModal(true)}
                          variant="soft"
                          size="1"
                        >
                          {savedQuery ? <PiPencil /> : <PiPlus />}
                        </IconButton>
                      </Flex>
                    }
                    containerClassName="mb-0"
                    containerStyle={{ flexBasis: "40%" }}
                    value={block.savedQueryId || ""}
                    placeholder="Choose a saved query"
                    options={savedQueryOptions}
                    onChange={(val) =>
                      setBlock({
                        ...block,
                        savedQueryId: val,
                        dataVizConfigIndex: 0,
                      })
                    }
                    isClearable
                  />

                  {savedQuery && (
                    <SelectField
                      label="Data Visualization"
                      labelClassName="font-weight-bold"
                      containerStyle={{ flexBasis: "40%" }}
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
