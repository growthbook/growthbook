import { Flex, Text } from "@radix-ui/themes";
import {
  DashboardBlockData,
  DashboardBlockInterface,
  DimensionBlockInterface,
} from "back-end/src/enterprise/validators/dashboard-block";
import React, { useEffect, useMemo } from "react";
import clsx from "clsx";
import { useForm } from "react-hook-form";
import {
  isDashboardBlockWithDifferenceType,
  isDashboardBlockWithMetricIds,
} from "shared/enterprise";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { isDefined } from "shared/util";
import { useSidebarOpen } from "@/components/Layout/SidebarOpenProvider";
import Button from "@/components/Radix/Button";
import Field from "@/components/Forms/Field";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import { useDefinitions } from "@/services/DefinitionsContext";
import SelectField from "@/components/Forms/SelectField";
import { BLOCK_TYPE_INFO } from ".";

interface Props {
  experiment: ExperimentInterfaceStringDates;
  open: boolean;
  close: () => void;
  block: DashboardBlockData<DashboardBlockInterface>;
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
      <Flex direction="column" py="6" px="7" gap="2">
        <Flex justify="between" align="center">
          <span>
            <Text weight="light">{BLOCK_TYPE_INFO[block.type].name}</Text>
            <Text weight="medium"> / {block.title}</Text>
          </span>
          <Flex gap="4">
            <Button variant="ghost" onClick={close}>
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
            containerClassName="w-25"
            {...form.register("title")}
          />
          <Field
            label="Description"
            labelClassName="font-weight-bold"
            {...form.register("description")}
            textarea
            minRows={1}
            maxRows={1}
            containerClassName="flex-grow-1 w-50"
          />
          {isDashboardBlockWithMetricIds(block) && (
            <MultiSelectField
              label="Metrics"
              labelClassName="font-weight-bold"
              value={form.watch("metricIds")}
              containerClassName="w-25"
              onChange={(value) => form.setValue("metricIds", value)}
              options={metricOptions}
            />
          )}
          {isDashboardBlockWithDifferenceType(block) && (
            <SelectField
              label="Difference Type"
              labelClassName="font-weight-bold"
              containerClassName="w-25"
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
        </Flex>
      </Flex>
    </div>
  );
}
