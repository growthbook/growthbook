import {
  DashboardBlockInterfaceOrData,
  MetricExperimentsBlockInterface,
} from "shared/enterprise";
import React, { useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiSlidersHorizontal } from "react-icons/pi";
import Text from "@/ui/Text";
import Link from "@/ui/Link";
import { Popover } from "@/ui/Popover";
import { useExperiments } from "@/hooks/useExperiments";
import SidebarExperimentFilters from "@/components/Search/SidebarExperimentFilters";
import MetricSelector from "@/components/Experiment/MetricSelector";
import { resolveMetricExperimentColumns } from "@/components/MetricExperiments/MetricExperiments";
import MetricExperimentsColumnSettings from "./MetricExperimentsColumnSettings";

interface Props {
  block: DashboardBlockInterfaceOrData<MetricExperimentsBlockInterface>;
  setBlock: React.Dispatch<
    DashboardBlockInterfaceOrData<MetricExperimentsBlockInterface>
  >;
  projects: string[];
}

export default function MetricExperimentsSettings({
  block,
  setBlock,
  projects,
}: Props) {
  const { experiments } = useExperiments();
  const [columnsOpen, setColumnsOpen] = useState(false);

  const resolvedColumns = resolveMetricExperimentColumns(
    block.columns,
    block.bandits,
  );
  const visibleLabels = resolvedColumns
    .filter((c) => c.visible)
    .map((c) => c.label);
  const hiddenCount = resolvedColumns.length - visibleLabels.length;
  const columnsSummary = ["Experiment", ...visibleLabels].join(", ");

  const searchValue = block.experimentSearchString;
  const setSearchValue = (value: string) =>
    setBlock({ ...block, experimentSearchString: value });

  return (
    <Flex direction="column" gap="5">
      <MetricSelector
        label="Metric"
        labelClassName="font-weight-bold"
        value={block.metricId}
        onChange={(metricId) => setBlock({ ...block, metricId })}
        includeFacts={true}
        projects={projects}
        placeholder="Select a metric..."
      />

      <Box>
        <Box mb="2">
          <Text weight="semibold">Filter Experiments</Text>
        </Box>
        <SidebarExperimentFilters
          searchValue={searchValue}
          setSearchValue={setSearchValue}
          experiments={experiments}
        />
      </Box>

      <Box>
        <Box mb="2">
          <Text weight="semibold">Columns</Text>
        </Box>
        <Flex
          align="center"
          gap="2"
          style={{
            border: "1px solid var(--gray-a5)",
            borderRadius: "var(--radius-3)",
            padding: "8px 10px",
          }}
        >
          <Box style={{ flex: 1, minWidth: 0 }}>
            <Text
              as="div"
              size="small"
              color="text-mid"
              truncate
              title={
                hiddenCount > 0
                  ? `${columnsSummary} · ${hiddenCount} hidden`
                  : columnsSummary
              }
            >
              {columnsSummary}
              {hiddenCount > 0 && (
                <Text as="span" color="text-low">
                  {" "}
                  · {hiddenCount} hidden
                </Text>
              )}
            </Text>
          </Box>
          <Box style={{ flexShrink: 0 }}>
            <Popover
              open={columnsOpen}
              onOpenChange={setColumnsOpen}
              align="end"
              trigger={
                <Link size="1" style={{ whiteSpace: "nowrap" }}>
                  <Flex align="center" gap="1">
                    <PiSlidersHorizontal />
                    Edit
                  </Flex>
                </Link>
              }
              content={
                <Box style={{ width: 260 }}>
                  <Box mb="2">
                    <Text size="small" color="text-low">
                      Drag to reorder or toggle visibility. The Experiment
                      column is always shown.
                    </Text>
                  </Box>
                  <MetricExperimentsColumnSettings
                    columns={resolvedColumns.map((c) => ({
                      id: c.id,
                      label: c.label,
                      visible: c.visible,
                    }))}
                    onChange={(columns) => setBlock({ ...block, columns })}
                  />
                </Box>
              }
            />
          </Box>
        </Flex>
      </Box>
    </Flex>
  );
}
