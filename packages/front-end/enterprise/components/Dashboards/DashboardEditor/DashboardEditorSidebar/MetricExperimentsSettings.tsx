import {
  DashboardBlockInterfaceOrData,
  MetricExperimentsBlockInterface,
  differenceTypes,
} from "shared/enterprise";
import React from "react";
import { Box, Flex } from "@radix-ui/themes";
import Text from "@/ui/Text";
import { useExperiments } from "@/hooks/useExperiments";
import SidebarExperimentFilters from "@/components/Search/SidebarExperimentFilters";
import MetricSelector from "@/components/Experiment/MetricSelector";
import SelectField from "@/components/Forms/SelectField";

const DIFFERENCE_TYPE_LABELS: Record<(typeof differenceTypes)[number], string> =
  {
    relative: "Relative",
    absolute: "Absolute",
    scaled: "Scaled Impact",
  };

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

  const searchValue = block.experimentSearchString;
  const setSearchValue = (value: string) =>
    setBlock({ ...block, experimentSearchString: value });

  return (
    <Flex direction="column" gap="5">
      <Box>
        <Box mb="2">
          <Text weight="semibold">Metric</Text>
        </Box>
        <MetricSelector
          value={block.metricId}
          onChange={(metricId) => setBlock({ ...block, metricId })}
          includeFacts={true}
          projects={projects}
          placeholder="Select a metric..."
        />
      </Box>

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
          <Text weight="semibold">Difference Type</Text>
        </Box>
        <SelectField
          value={block.differenceType}
          onChange={(value) =>
            setBlock({
              ...block,
              differenceType:
                value as MetricExperimentsBlockInterface["differenceType"],
            })
          }
          options={differenceTypes.map((dt) => ({
            label: DIFFERENCE_TYPE_LABELS[dt],
            value: dt,
          }))}
          sort={false}
        />
      </Box>
    </Flex>
  );
}
