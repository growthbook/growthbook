import { ReactNode } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { ExplorationDateRange } from "shared/validators";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import Text from "@/ui/Text";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useExperiments } from "@/hooks/useExperiments";
import SidebarExperimentFilters from "@/components/Search/SidebarExperimentFilters";
import BlockDateRangePicker from "./BlockDateRangePicker";

export interface CompletedExperimentsFilterValue {
  dateRange: ExplorationDateRange;
  projects: string[];
  // Raw ExperimentSearchFilters query string; applied client-side on top of the
  // date/project scope.
  experimentSearchString?: string;
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
  // Optional content rendered between the Date Range and Projects fields
  // (e.g. Team Velocity's Date Granularity control).
  afterDateRange?: ReactNode;
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
  afterDateRange,
  comparisonEnabled,
  previousTimeFrame,
  onPreviousTimeFrameChange,
}: Props) {
  const { projects } = useDefinitions();
  const { experiments } = useExperiments();

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

      {afterDateRange}

      <Box>
        <Box mb="2">
          <Text weight="semibold">Projects Filter</Text>
        </Box>
        <MultiSelectField
          value={value.projects}
          options={projectOptions}
          onChange={(v) => onChange({ projects: v })}
          placeholder="All projects"
        />
      </Box>

      <Box>
        <Box mb="2">
          <Text weight="semibold">Filter Experiments</Text>
        </Box>
        <SidebarExperimentFilters
          searchValue={value.experimentSearchString ?? ""}
          setSearchValue={(experimentSearchString) =>
            onChange({ experimentSearchString })
          }
          experiments={experiments}
          // These blocks only ever include completed (stopped) experiments, so
          // the status filter would be misleading.
          allowDrafts={false}
          showStatusFilter={false}
          // The "Projects" field above already scopes by project.
          showProjectFilter={false}
        />
      </Box>
    </>
  );
}
