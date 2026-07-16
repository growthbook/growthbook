import { ReactNode } from "react";
import { ExplorationDateRange } from "shared/validators";
import {
  DashboardInterface,
  globalFilterIsSet,
  DashboardGlobalFilterKey,
} from "shared/enterprise";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useExperiments } from "@/hooks/useExperiments";
import SidebarExperimentFilters from "@/components/Search/SidebarExperimentFilters";
import { formatExplorationDateRange } from "@/enterprise/components/ProductAnalytics/dateRangeLabels";
import BlockDateRangePicker from "./BlockDateRangePicker";
import GlobalControlField from "./GlobalControlField";

export interface CompletedExperimentsFilterValue {
  dateRange: ExplorationDateRange;
  projects: string[];
  // Raw ExperimentSearchFilters query string; applied client-side on top of the
  // date/project scope.
  experimentSearchString?: string;
}

type GlobalControlSettings =
  | {
      dateRange?: boolean;
      projects?: boolean;
      experimentSearchString?: boolean;
    }
  | undefined;

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
  // Dashboard-wide global filters. When one is active for a field the block
  // supports, an opt-in toggle is shown and (when opted in) the local control is
  // replaced by the effective dashboard value.
  dashboardGlobalControls?: DashboardInterface["globalControls"];
  globalControlSettings?: GlobalControlSettings;
  onGlobalControlSettingChange?: (
    key: DashboardGlobalFilterKey,
    enabled: boolean,
  ) => void;
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
  globalControlSettings,
  onGlobalControlSettingChange,
}: Props) {
  const { projects } = useDefinitions();
  const { experiments } = useExperiments();

  const projectOptions = (
    availableProjects && availableProjects.length > 0
      ? projects.filter((p) => availableProjects.includes(p.id))
      : projects
  ).map((p) => ({ label: p.name, value: p.id }));

  const projectName = (id: string) =>
    projectOptions.find((p) => p.value === id)?.label ?? id;

  const dateControlled =
    globalFilterIsSet(dashboardGlobalControls, "dateRange") &&
    globalControlSettings?.dateRange === true;
  const projectsControlled =
    globalFilterIsSet(dashboardGlobalControls, "projects") &&
    globalControlSettings?.projects === true;
  const experimentControlled =
    globalFilterIsSet(dashboardGlobalControls, "experimentSearchString") &&
    globalControlSettings?.experimentSearchString === true;

  const dashboardProjects = dashboardGlobalControls?.projects ?? [];
  const projectsSummary =
    dashboardProjects.length === 0
      ? "All projects"
      : dashboardProjects.map(projectName).join(", ");

  return (
    <>
      <GlobalControlField
        label="Date Range"
        globalActive={globalFilterIsSet(dashboardGlobalControls, "dateRange")}
        controlled={dateControlled}
        onToggle={(enabled) =>
          onGlobalControlSettingChange?.("dateRange", enabled)
        }
        controlledSummary={
          dashboardGlobalControls?.dateRange
            ? formatExplorationDateRange(dashboardGlobalControls.dateRange, {
                customDateRangeFallback: "Date Range",
              })
            : ""
        }
        accessory={dateRangeAccessory}
      >
        <BlockDateRangePicker
          value={value.dateRange}
          onChange={(dateRange) => onChange({ dateRange })}
          comparisonEnabled={comparisonEnabled}
          previousTimeFrame={previousTimeFrame}
          onPreviousTimeFrameChange={onPreviousTimeFrameChange}
        />
      </GlobalControlField>

      {afterDateRange}

      <GlobalControlField
        label="Projects Filter"
        globalActive={globalFilterIsSet(dashboardGlobalControls, "projects")}
        controlled={projectsControlled}
        onToggle={(enabled) =>
          onGlobalControlSettingChange?.("projects", enabled)
        }
        controlledSummary={projectsSummary}
      >
        <MultiSelectField
          value={value.projects}
          options={projectOptions}
          onChange={(v) => onChange({ projects: v })}
          placeholder="All projects"
        />
      </GlobalControlField>

      <GlobalControlField
        label="Filter Experiments"
        globalActive={globalFilterIsSet(
          dashboardGlobalControls,
          "experimentSearchString",
        )}
        controlled={experimentControlled}
        onToggle={(enabled) =>
          onGlobalControlSettingChange?.("experimentSearchString", enabled)
        }
        controlledSummary={
          dashboardGlobalControls?.experimentSearchString || "All experiments"
        }
      >
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
      </GlobalControlField>
    </>
  );
}
