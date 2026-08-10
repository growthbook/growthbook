import { ReactNode } from "react";
import { dateGranularity, ExplorationDateRange } from "shared/validators";
import {
  BlockComparison,
  DashboardInterface,
  globalFilterIsSet,
} from "shared/enterprise";
import MultiSelectField from "@/ui/MultiSelectField";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useExperiments } from "@/hooks/useExperiments";
import SidebarExperimentFilters from "@/components/Search/SidebarExperimentFilters";
import DateRangeCompareDropdown from "@/enterprise/components/ProductAnalytics/DateRangeCompareDropdown";
import SidebarSettingField from "./SidebarSettingField";
import DashboardInheritControl from "./DashboardInheritControl";

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

// Per-field opt-in flags: whether the block follows the dashboard for each of
// these filters (the fields this component renders).
type FollowKey = "dateRange" | "projects" | "experimentSearchString";

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
  showGranularity = false,
  showCompare = false,
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
  // The dashboard date filter carries its own granularity, so a block following
  // it is bucketed by the dashboard too — show that rather than the block's own.
  const granularityValue = dateControlled
    ? (dashboardGlobalControls?.dateGranularity ?? value.dateGranularity)
    : value.dateGranularity;
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
            <DashboardInheritControl
              label="Date Range"
              inherited={dateFollowing}
              onChange={(inherited) => onToggleFollow("dateRange", inherited)}
            />
          ) : undefined
        }
      >
        <DateRangeCompareDropdown
          fullWidth
          showCompare={showCompare}
          showGranularity={showGranularity}
          disabled={dateControlled}
          value={{
            dateRange: dateRangeValue,
            comparison: (showCompare ? value.comparison : null) ?? null,
            granularity: granularityValue,
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
      </SidebarSettingField>

      {afterDateRange}

      <SidebarSettingField
        label="Projects"
        accessory={
          projectsSet ? (
            <DashboardInheritControl
              label="Projects"
              inherited={projectsFollowing}
              onChange={(inherited) => onToggleFollow("projects", inherited)}
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
        label="Experiment filters"
        accessory={
          searchSet ? (
            <DashboardInheritControl
              label="Experiment filters"
              inherited={searchFollowing}
              onChange={(inherited) =>
                onToggleFollow("experimentSearchString", inherited)
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
