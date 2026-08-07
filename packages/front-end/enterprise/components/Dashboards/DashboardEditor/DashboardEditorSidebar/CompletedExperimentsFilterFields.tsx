import { ReactNode } from "react";
import { Box } from "@radix-ui/themes";
import { dateGranularity, ExplorationDateRange } from "shared/validators";
import { BlockComparison } from "shared/enterprise";
import MultiSelectField from "@/ui/MultiSelectField";
import Text from "@/ui/Text";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useExperiments } from "@/hooks/useExperiments";
import SidebarExperimentFilters from "@/components/Search/SidebarExperimentFilters";
import DateRangeCompareDropdown from "@/enterprise/components/ProductAnalytics/DateRangeCompareDropdown";

export interface CompletedExperimentsFilterValue {
  dateRange: ExplorationDateRange;
  projects: string[];
  // Raw ExperimentSearchFilters query string; applied client-side on top of the
  // date/project scope.
  experimentSearchString?: string;
  // Both patched through the same `onChange` as `dateRange` — see below.
  comparison?: BlockComparison;
  dateGranularity?: (typeof dateGranularity)[number];
}

interface Props {
  value: CompletedExperimentsFilterValue;
  onChange: (patch: Partial<CompletedExperimentsFilterValue>) => void;
  // Restrict the project options (e.g. to the dashboard's projects). Empty
  // means all org projects are selectable.
  availableProjects?: string[];
  // Optional content rendered between the Date Range and Projects fields.
  afterDateRange?: ReactNode;
  /** Blocks that bucket a time series (Team Velocity) opt in. */
  showGranularity?: boolean;
  /** Blocks that can't render a previous period leave this off. */
  showCompare?: boolean;
}

// Shared date-range + project scoping controls for the "Completed Experiments"
// block settings editors (Scaled Impact, Win Percentage, Team Velocity).
export default function CompletedExperimentsFilterFields({
  value,
  onChange,
  availableProjects,
  afterDateRange,
  showGranularity = false,
  showCompare = false,
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
        <Box mb="2">
          <Text weight="semibold">Date Range</Text>
        </Box>
        <DateRangeCompareDropdown
          fullWidth
          showCompare={showCompare}
          showGranularity={showGranularity}
          value={{
            dateRange: value.dateRange,
            comparison: (showCompare ? value.comparison : null) ?? null,
            granularity: value.dateGranularity,
          }}
          // One Apply, one patch. Fanning out to separate setters, each
          // spreading the same `block`, let the last one undo the others.
          onChange={(next) =>
            onChange({
              dateRange: next.dateRange,
              ...(showCompare
                ? { comparison: next.comparison ?? undefined }
                : {}),
              ...(showGranularity && next.granularity
                ? { dateGranularity: next.granularity }
                : {}),
            })
          }
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
