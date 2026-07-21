import { ReactNode } from "react";
import { ExplorationDateRange } from "shared/validators";
import { DashboardInterface, globalFilterIsSet } from "shared/enterprise";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useExperiments } from "@/hooks/useExperiments";
import SidebarExperimentFilters from "@/components/Search/SidebarExperimentFilters";
import BlockDateRangePicker from "./BlockDateRangePicker";
import SidebarSettingField from "./SidebarSettingField";
import DashboardFollowToggle from "./DashboardFollowToggle";

export interface CompletedExperimentsFilterValue {
  dateRange: ExplorationDateRange;
  projects: string[];
  // Raw ExperimentSearchFilters query string; applied client-side on top of the
  // date/project scope.
  experimentSearchString?: string;
}

// Per-field opt-in flags: whether the block follows the dashboard for each of
// these filters (the fields this component renders).
type FollowKey = "dateRange" | "projects" | "experimentSearchString";

interface Props {
  value: CompletedExperimentsFilterValue;
  onChange: (patch: Partial<CompletedExperimentsFilterValue>) => void;
  // Restrict the project options (e.g. to the dashboard's projects). Empty
  // means all org projects are selectable.
  availableProjects?: string[];
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
  // The block's per-field opt-in flags and a setter, driving the per-field
  // "Use dashboard … filter" toggles on each field's label row.
  globalControlSettings?: {
    dateRange?: boolean;
    projects?: boolean;
    experimentSearchString?: boolean;
  };
  onToggleFollow: (key: FollowKey, enabled: boolean) => void;
}

// Shared date-range + project scoping controls for the "Completed Experiments"
// block settings editors (Scaled Impact, Win Percentage, Team Velocity).
export default function CompletedExperimentsFilterFields({
  value,
  onChange,
  availableProjects,
  afterDateRange,
  comparisonEnabled,
  previousTimeFrame,
  onPreviousTimeFrameChange,
  dashboardGlobalControls,
  globalControlSettings,
  onToggleFollow,
}: Props) {
  const { projects } = useDefinitions();
  const { experiments } = useExperiments();

  const projectOptions = (
    availableProjects && availableProjects.length > 0
      ? projects.filter((p) => availableProjects.includes(p.id))
      : projects
  ).map((p) => ({ label: p.name, value: p.id }));

  // Each field follows the dashboard only when the block has opted in AND the
  // dashboard currently has a value for that filter. The per-field toggle is
  // shown whenever the dashboard has a value to follow.
  const dateSet = globalFilterIsSet(dashboardGlobalControls, "dateRange");
  const projectsSet = globalFilterIsSet(dashboardGlobalControls, "projects");
  const searchSet = globalFilterIsSet(
    dashboardGlobalControls,
    "experimentSearchString",
  );

  const dateFollowing = globalControlSettings?.dateRange === true;
  const projectsFollowing = globalControlSettings?.projects === true;
  const searchFollowing =
    globalControlSettings?.experimentSearchString === true;

  const dateControlled = dateFollowing && dateSet;
  const projectsControlled = projectsFollowing && projectsSet;
  const experimentControlled = searchFollowing && searchSet;

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
      <SidebarSettingField
        label="Date Range"
        accessory={
          dateSet ? (
            <DashboardFollowToggle
              label="Use dashboard date filter"
              tooltip="Follow the dashboard's date range instead of this block's own. Turn off to set a date range just for this block."
              value={dateFollowing}
              onChange={(enabled) => onToggleFollow("dateRange", enabled)}
            />
          ) : undefined
        }
      >
        <BlockDateRangePicker
          value={dateRangeValue}
          onChange={(dateRange) => onChange({ dateRange })}
          comparisonEnabled={comparisonEnabled}
          previousTimeFrame={previousTimeFrame}
          onPreviousTimeFrameChange={onPreviousTimeFrameChange}
          disabled={dateControlled}
        />
      </SidebarSettingField>

      {afterDateRange}

      <SidebarSettingField
        label="Projects Filter"
        accessory={
          projectsSet ? (
            <DashboardFollowToggle
              label="Use dashboard filter"
              tooltip="Follow the dashboard's projects filter instead of this block's own. Turn off to set projects just for this block."
              value={projectsFollowing}
              onChange={(enabled) => onToggleFollow("projects", enabled)}
            />
          ) : undefined
        }
      >
        <MultiSelectField
          value={projectsValue}
          options={projectOptions}
          onChange={(v) => onChange({ projects: v })}
          placeholder="All projects"
          disabled={projectsControlled}
        />
      </SidebarSettingField>

      <SidebarSettingField
        label="Filter Experiments"
        accessory={
          searchSet ? (
            <DashboardFollowToggle
              label="Use dashboard filter"
              tooltip="Follow the dashboard's experiment filter instead of this block's own. Turn off to filter experiments just for this block."
              value={searchFollowing}
              onChange={(enabled) =>
                onToggleFollow("experimentSearchString", enabled)
              }
            />
          ) : undefined
        }
      >
        <SidebarExperimentFilters
          searchValue={searchValue}
          setSearchValue={
            experimentControlled
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
          searchDisabled={experimentControlled}
        />
      </SidebarSettingField>
    </>
  );
}
