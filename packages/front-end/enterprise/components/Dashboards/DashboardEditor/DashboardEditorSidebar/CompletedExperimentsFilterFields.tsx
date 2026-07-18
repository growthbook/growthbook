import { ReactNode } from "react";
import { ExplorationDateRange } from "shared/validators";
import { DashboardInterface, globalFilterIsSet } from "shared/enterprise";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useExperiments } from "@/hooks/useExperiments";
import SidebarExperimentFilters from "@/components/Search/SidebarExperimentFilters";
import BlockDateRangePicker from "./BlockDateRangePicker";
import SidebarSettingField from "./SidebarSettingField";

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
  // Dashboard-wide global filters, used to populate the fields read-only when
  // the block follows them.
  dashboardGlobalControls?: DashboardInterface["globalControls"];
  // Whether the block is following the dashboard's experiment filters (driven by
  // the single toggle at the top of the block's settings form). When true, each
  // field the dashboard has an active value for is shown populated with that
  // value and disabled.
  following?: boolean;
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
  dashboardGlobalControls,
  following = false,
}: Props) {
  const { projects } = useDefinitions();
  const { experiments } = useExperiments();

  const projectOptions = (
    availableProjects && availableProjects.length > 0
      ? projects.filter((p) => availableProjects.includes(p.id))
      : projects
  ).map((p) => ({ label: p.name, value: p.id }));

  // When the block follows the dashboard filters, every filter field is locked —
  // the block delegates its experiment filtering to the dashboard. Fields the
  // dashboard actually sets a value for also display that value (below); the
  // rest stay locked on the block's own value.
  const dateControlled =
    following && globalFilterIsSet(dashboardGlobalControls, "dateRange");
  const projectsControlled =
    following && globalFilterIsSet(dashboardGlobalControls, "projects");
  const experimentControlled =
    following &&
    globalFilterIsSet(dashboardGlobalControls, "experimentSearchString");

  const dateRangeValue =
    dateControlled && dashboardGlobalControls?.dateRange
      ? dashboardGlobalControls.dateRange
      : value.dateRange;
  const projectsValue = projectsControlled
    ? (dashboardGlobalControls?.projects ?? [])
    : value.projects;
  const searchValue = experimentControlled
    ? (dashboardGlobalControls?.experimentSearchString ?? "")
    : (value.experimentSearchString ?? "");

  return (
    <>
      <SidebarSettingField label="Date Range" accessory={dateRangeAccessory}>
        <BlockDateRangePicker
          value={dateRangeValue}
          onChange={(dateRange) => onChange({ dateRange })}
          comparisonEnabled={comparisonEnabled}
          previousTimeFrame={previousTimeFrame}
          onPreviousTimeFrameChange={onPreviousTimeFrameChange}
          disabled={following}
        />
      </SidebarSettingField>

      {afterDateRange}

      <SidebarSettingField label="Projects Filter">
        <MultiSelectField
          value={projectsValue}
          options={projectOptions}
          onChange={(v) => onChange({ projects: v })}
          placeholder="All projects"
          disabled={following}
        />
      </SidebarSettingField>

      <SidebarSettingField label="Filter Experiments">
        <SidebarExperimentFilters
          searchValue={searchValue}
          setSearchValue={
            following
              ? () => {}
              : (experimentSearchString) => onChange({ experimentSearchString })
          }
          experiments={experiments}
          // These blocks only ever include completed (stopped) experiments, so
          // the status filter would be misleading.
          allowDrafts={false}
          showStatusFilter={false}
          // The "Projects" field above already scopes by project.
          showProjectFilter={false}
          searchDisabled={following}
        />
      </SidebarSettingField>
    </>
  );
}
