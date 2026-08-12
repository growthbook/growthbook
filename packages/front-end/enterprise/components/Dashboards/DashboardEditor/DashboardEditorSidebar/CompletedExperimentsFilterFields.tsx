import { ReactNode } from "react";
import { Flex } from "@radix-ui/themes";
import { dateGranularity, ExplorationDateRange } from "shared/validators";
import {
  BlockComparison,
  DashboardInterface,
  globalFilterIsSet,
} from "shared/enterprise";
import MultiSelectField from "@/ui/MultiSelectField";
import Link from "@/ui/Link";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useExperiments } from "@/hooks/useExperiments";
import SidebarExperimentFilters, {
  experimentSearchIsActive,
} from "@/components/Search/SidebarExperimentFilters";
import DateRangeCompareDropdown from "@/enterprise/components/ProductAnalytics/DateRangeCompareDropdown";
import SidebarSettingField from "./SidebarSettingField";
import DashboardFilterInheritTag from "./DashboardFilterInheritTag";

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

type FollowKey = "dateRange" | "experimentSearchString";

interface Props {
  value: CompletedExperimentsFilterValue;
  // Keys in `claim` stop following the dashboard in the same update as the patch,
  // so the value and the flag can't clobber each other.
  onChange: (
    patch: Partial<CompletedExperimentsFilterValue>,
    claim?: FollowKey[],
  ) => void;
  onRevert: (key: FollowKey) => void;
  // Restrict the project options (e.g. to the dashboard's projects). Empty
  // means all org projects are selectable.
  availableProjects?: string[];
  // Optional content rendered between the Date Range and Projects fields.
  afterDateRange?: ReactNode;
  /** Blocks that bucket a time series (Team Velocity) opt in. */
  showGranularity?: boolean;
  /** Blocks that can't render a previous period leave this off. */
  showCompare?: boolean;
  dashboardGlobalControls?: DashboardInterface["globalControls"];
  globalControlSettings?: {
    dateRange?: boolean;
    experimentSearchString?: boolean;
  };
}

// Shared date-range + project scoping controls for the "Completed Experiments"
// block settings editors (Scaled Impact, Win Percentage, Team Velocity).
export default function CompletedExperimentsFilterFields({
  value,
  onChange,
  onRevert,
  availableProjects,
  afterDateRange,
  showGranularity = false,
  showCompare = false,
  dashboardGlobalControls,
  globalControlSettings,
}: Props) {
  const { projects } = useDefinitions();
  const { experiments } = useExperiments();

  const projectOptions = (
    availableProjects && availableProjects.length > 0
      ? projects.filter((p) => availableProjects.includes(p.id))
      : projects
  ).map((p) => ({ label: p.name, value: p.id }));

  // A field inherits only if the block opted in AND the dashboard has a value.
  const dateSet = globalFilterIsSet(dashboardGlobalControls, "dateRange");
  const searchSet = globalFilterIsSet(
    dashboardGlobalControls,
    "experimentSearchString",
  );

  const dateInherited = globalControlSettings?.dateRange === true && dateSet;
  const searchInherited =
    globalControlSettings?.experimentSearchString === true && searchSet;

  const dateRangeValue =
    dateInherited && dashboardGlobalControls?.dateRange
      ? dashboardGlobalControls.dateRange
      : value.dateRange;
  // The dashboard date filter carries its own granularity, so inheriting the date
  // means inheriting the bucketing too.
  const granularityValue = dateInherited
    ? (dashboardGlobalControls?.dateGranularity ?? value.dateGranularity)
    : value.dateGranularity;
  // While the block follows the dashboard's experiment filters, the dashboard's
  // `project:` token is the only project scope applied (getEffectiveExperimentBlock
  // clears the block's own list), so show this field as empty and disabled rather
  // than displaying a value that isn't in play.
  const projectsValue = searchInherited ? [] : value.projects;
  const searchValue = searchInherited
    ? (dashboardGlobalControls?.experimentSearchString ?? "")
    : (value.experimentSearchString ?? "");

  // While inheriting, Revert is the way back — so no Clear all.
  const showClearAll =
    !searchInherited && experimentSearchIsActive(searchValue);

  return (
    <>
      <SidebarSettingField
        label="Date Range"
        accessory={
          dateSet ? (
            <DashboardFilterInheritTag
              label="Date Range"
              inherited={dateInherited}
              onRevert={() => onRevert("dateRange")}
            />
          ) : undefined
        }
      >
        <DateRangeCompareDropdown
          fullWidth
          showCompare={showCompare}
          showGranularity={showGranularity}
          value={{
            dateRange: dateRangeValue,
            comparison: (showCompare ? value.comparison : null) ?? null,
            granularity: granularityValue,
          }}
          // One Apply, one patch — separate setters would undo each other.
          onChange={(next) =>
            onChange(
              {
                dateRange: next.dateRange,
                ...(showCompare
                  ? { comparison: next.comparison ?? undefined }
                  : {}),
                ...(showGranularity && next.granularity
                  ? { dateGranularity: next.granularity }
                  : {}),
              },
              dateInherited ? ["dateRange"] : [],
            )
          }
        />
      </SidebarSettingField>

      {afterDateRange}

      <SidebarSettingField label="Projects">
        <MultiSelectField
          value={projectsValue}
          options={projectOptions}
          onChange={(v) => onChange({ projects: v })}
          disabled={searchInherited}
          placeholder={
            searchInherited ? "Set by dashboard filters" : "All projects"
          }
        />
      </SidebarSettingField>

      <SidebarSettingField
        label="Experiment filters"
        accessory={
          showClearAll || searchSet ? (
            <Flex align="center" gap="3">
              {showClearAll ? (
                <Link
                  size="sm"
                  color="red"
                  onClick={() => onChange({ experimentSearchString: "" })}
                >
                  Clear all
                </Link>
              ) : null}
              {searchSet ? (
                <DashboardFilterInheritTag
                  label="Experiment filters"
                  inherited={searchInherited}
                  onRevert={() => onRevert("experimentSearchString")}
                />
              ) : null}
            </Flex>
          ) : undefined
        }
      >
        <SidebarExperimentFilters
          searchValue={searchValue}
          // The displayed string is already the dashboard's, so an edit keeps
          // whichever inherited tokens the user left alone.
          setSearchValue={(experimentSearchString) =>
            onChange(
              { experimentSearchString },
              searchInherited ? ["experimentSearchString"] : [],
            )
          }
          experiments={experiments}
          // These blocks only ever include completed (stopped) experiments, so
          // the status filter would be misleading.
          allowDrafts={false}
          showStatusFilter={false}
          // The "Projects" field above already scopes by project.
          showProjectFilter={false}
        />
      </SidebarSettingField>
    </>
  );
}
