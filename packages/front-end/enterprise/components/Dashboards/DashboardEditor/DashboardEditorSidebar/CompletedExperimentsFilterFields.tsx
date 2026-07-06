import { ReactNode } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { ExplorationDateRange } from "shared/validators";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import Text from "@/ui/Text";
import { useDefinitions } from "@/services/DefinitionsContext";
import BlockDateRangePicker from "./BlockDateRangePicker";

export interface CompletedExperimentsFilterValue {
  dateRange: ExplorationDateRange;
  projects: string[];
}

interface Props {
  value: CompletedExperimentsFilterValue;
  onChange: (patch: Partial<CompletedExperimentsFilterValue>) => void;
  // Restrict the project options (e.g. to the dashboard's projects). Empty
  // means all org projects are selectable.
  availableProjects?: string[];
  // Optional control rendered on the right of the "Date Range" label row (e.g.
  // a Compare toggle), mirroring the Metric Explorer editor header.
  dateRangeAccessory?: ReactNode;
  // Comparison support: when enabled and the range is a Custom Date Range, the
  // picker shows the Prior / Current fields backed by previousTimeFrame.
  comparisonEnabled?: boolean;
  previousTimeFrame?: ExplorationDateRange;
  onPreviousTimeFrameChange?: (dr: ExplorationDateRange) => void;
}

// Shared date-range + project scoping controls for the "Completed Experiments"
// block settings editors (Scaled Impact, Win Percentage, Team Velocity).
export default function CompletedExperimentsFilterFields({
  value,
  onChange,
  availableProjects,
  dateRangeAccessory,
  comparisonEnabled,
  previousTimeFrame,
  onPreviousTimeFrameChange,
}: Props) {
  const { projects } = useDefinitions();

  const projectOptions = (
    availableProjects && availableProjects.length > 0
      ? projects.filter((p) => availableProjects.includes(p.id))
      : projects
  ).map((p) => ({ label: p.name, value: p.id }));

  return (
    <>
      <Box>
        <Flex justify="between" align="center" mb="2">
          <Text weight="semibold">Date Range</Text>
          {dateRangeAccessory}
        </Flex>
        <BlockDateRangePicker
          value={value.dateRange}
          onChange={(dateRange) => onChange({ dateRange })}
          comparisonEnabled={comparisonEnabled}
          previousTimeFrame={previousTimeFrame}
          onPreviousTimeFrameChange={onPreviousTimeFrameChange}
        />
      </Box>

      <Box>
        <Box mb="2">
          <Text weight="semibold">Projects</Text>
        </Box>
        <MultiSelectField
          value={value.projects}
          options={projectOptions}
          onChange={(v) => onChange({ projects: v })}
          placeholder="All projects"
        />
      </Box>
    </>
  );
}
