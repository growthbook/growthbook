import { Flex, IconButton, Text } from "@radix-ui/themes";
import {
  DashboardBlockData,
  DashboardBlockInterface,
  DimensionBlockInterface,
} from "back-end/src/enterprise/validators/dashboard-block";
import React, { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { useForm } from "react-hook-form";
import {
  isDashboardBlockWithDifferenceType,
  isDashboardBlockWithMetricIds,
  isSqlExplorerBlock,
} from "shared/enterprise";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { isDefined } from "shared/util";
import { SavedQuery } from "back-end/src/validators/saved-queries";
import { PiPencil, PiPlus } from "react-icons/pi";
import { useSidebarOpen } from "@/components/Layout/SidebarOpenProvider";
import Button from "@/components/Radix/Button";
import Field from "@/components/Forms/Field";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import { useDefinitions } from "@/services/DefinitionsContext";
import SelectField from "@/components/Forms/SelectField";
import LoadingSpinner from "@/components/LoadingSpinner";
import useApi from "@/hooks/useApi";
import Callout from "@/components/Radix/Callout";
import SqlExplorerModal from "@/components/SchemaBrowser/SqlExplorerModal";
import { BLOCK_TYPE_INFO } from ".";

interface Props {
  experiment: ExperimentInterfaceStringDates;
  open: boolean;
  close: () => void;
  block?: DashboardBlockData<DashboardBlockInterface>;
  setBlock: React.Dispatch<DashboardBlockData<DashboardBlockInterface>>;
}
export default function DashboardBlockEditDrawer({
  experiment,
  open,
  close,
  block,
  setBlock,
}: Props) {
  const { open: sidebarOpen } = useSidebarOpen();
  const { metrics, factMetrics } = useDefinitions();
  const { data: savedQueriesData, mutate: mutateQuery, isLoading } = useApi<{
    status: number;
    savedQueries: SavedQuery[];
  }>(`/saved-queries/`);

  const [showSqlExplorerModal, setShowSqlExplorerModal] = useState(false);

  const form = useForm<DashboardBlockData<DashboardBlockInterface>>({
    defaultValues: block,
  });

  useEffect(() => {
    form.reset(block);
  }, [form, block]);

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
        transition: "all 0.5s cubic-bezier(0.685, 0.0473, 0.346, 1)",
        position: "fixed",
        bottom: 0,
        right: 0,
        height: open ? "330px" : "0px",
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
        />
      )}
      {block && (
        <Flex direction="column" py="6" px="7" gap="2">
          <Flex justify="between" align="center">
            <span>
              <Text weight="light">{BLOCK_TYPE_INFO[block.type].name}</Text>
              <Text weight="medium"> / {block.title}</Text>
            </span>
            <Flex gap="4">
              <Button
                variant="ghost"
                onClick={() => {
                  form.reset({});
                  close();
                }}
              >
                Cancel
              </Button>
              <Button
                onClick={() => {
                  setBlock(form.getValues());
                  close();
                }}
              >
                Save & Close
              </Button>
            </Flex>
          </Flex>
          <Text>
            Block will update with real-time results when global “Update” button
            is clicked.
          </Text>
          <Flex wrap="wrap" gap="4">
            <Field
              label="Block Title"
              labelClassName="font-weight-bold"
              containerClassName="mb-0"
              containerStyle={{ flexBasis: "30%" }}
              {...form.register("title")}
            />
            <Field
              label="Description"
              labelClassName="font-weight-bold"
              containerClassName="mb-0"
              containerStyle={{ flexBasis: "60%" }}
              {...form.register("description")}
              textarea
              minRows={1}
              maxRows={1}
            />
            {isDashboardBlockWithMetricIds(block) && (
              <MultiSelectField
                label="Metrics"
                labelClassName="font-weight-bold"
                value={form.watch("metricIds") || []}
                containerStyle={{ flexBasis: "30%" }}
                containerClassName="mb-0"
                onChange={(value) => form.setValue("metricIds", value)}
                options={metricOptions}
              />
            )}
            {isDashboardBlockWithDifferenceType(block) && (
              <SelectField
                label="Difference Type"
                labelClassName="font-weight-bold"
                containerStyle={{ flexBasis: "30%" }}
                containerClassName="mb-0"
                value={form.watch("differenceType") || ""}
                onChange={(value) =>
                  form.setValue(
                    "differenceType",
                    value as DimensionBlockInterface["differenceType"]
                  )
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
