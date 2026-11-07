import {
  DashboardBlockInterfaceOrData,
  DashboardInterface,
  MetricExperimentsBlockInterface,
  isDifferenceType,
  DIFFERENCE_TYPE_OPTIONS,
  blockUsesGlobalFilter,
  globalFilterIsSet,
  withBlockGlobalFilterFollowing,
} from "shared/enterprise";
import { ExplorationDateRange } from "shared/validators";
import React from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiSlidersHorizontal } from "react-icons/pi";
import Text from "@/ui/Text";
import Link from "@/ui/Link";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useExperiments } from "@/hooks/useExperiments";
import SidebarExperimentFilters, {
  ExtraFilter,
  experimentSearchIsActive,
} from "@/components/Search/SidebarExperimentFilters";
import MetricSelector from "@/components/Experiment/MetricSelector";
import SelectField from "@/components/Forms/SelectField";
import MultiSelectField from "@/ui/MultiSelectField";
import { resolveMetricExperimentColumns } from "@/components/MetricExperiments/MetricExperiments";
import { DATE_RANGE_PREDEFINED_LABELS } from "@/enterprise/components/ProductAnalytics/dateRangeLabels";
import ColumnSettingsButton from "@/ui/ColumnSettingsButton";
import BlockDateRangePicker from "./BlockDateRangePicker";
import SidebarSettingField from "./SidebarSettingField";
import DashboardFilterInheritTag from "./DashboardFilterInheritTag";

// Short human-readable label for a date range, shown on the filter pill.
function formatDateRange(dr: ExplorationDateRange): string {
  if (
    dr.predefined === "customLookback" &&
    dr.lookbackValue &&
    dr.lookbackUnit
  ) {
    const plural = dr.lookbackValue === 1 ? "" : "s";
    return `Last ${dr.lookbackValue} ${dr.lookbackUnit}${plural}`;
  }
  if (dr.predefined === "customDateRange") {
    return `${dr.startDate ?? "…"} – ${dr.endDate ?? "…"}`;
  }
  return DATE_RANGE_PREDEFINED_LABELS[dr.predefined];
}

const DEFAULT_DATE_RANGE: ExplorationDateRange = { predefined: "last30Days" };

interface Props {
  block: DashboardBlockInterfaceOrData<MetricExperimentsBlockInterface>;
  setBlock: React.Dispatch<
    DashboardBlockInterfaceOrData<MetricExperimentsBlockInterface>
  >;
  projects: string[];
  dashboardGlobalControls?: DashboardInterface["globalControls"];
}

export default function MetricExperimentsSettings({
  block,
  setBlock,
  projects,
  dashboardGlobalControls,
}: Props) {
  const { projects: allProjects } = useDefinitions();
  const { experiments } = useExperiments();

  // A field inherits only if the block opted in AND the dashboard has a value.
  const projectsSet = globalFilterIsSet(dashboardGlobalControls, "projects");
  const searchSet = globalFilterIsSet(
    dashboardGlobalControls,
    "experimentSearchString",
  );

  const projectsInherited =
    blockUsesGlobalFilter(block, "projects") && projectsSet;
  const searchInherited =
    blockUsesGlobalFilter(block, "experimentSearchString") && searchSet;

  // Keys in `claim` stop following the dashboard in the same update as the patch.
  const patchBlock = (
    patch: Partial<MetricExperimentsBlockInterface>,
    claim: ("projects" | "experimentSearchString")[] = [],
  ) =>
    setBlock(
      withBlockGlobalFilterFollowing({ ...block, ...patch }, claim, false),
    );

  const revert = (key: "projects" | "experimentSearchString") =>
    setBlock(withBlockGlobalFilterFollowing(block, [key], true));

  const dashboardProjects = dashboardGlobalControls?.projects ?? [];

  const projectOptions = (
    projects.length > 0
      ? allProjects.filter((p) => projects.includes(p.id))
      : allProjects
  ).map((p) => ({ label: p.name, value: p.id }));

  const projectsValue = projectsInherited ? dashboardProjects : block.projects;

  const resolvedColumns = resolveMetricExperimentColumns(
    block.columns,
    block.bandits,
  );
  const visibleLabels = resolvedColumns
    .filter((c) => c.visible)
    .map((c) => c.label);
  const hiddenCount = resolvedColumns.length - visibleLabels.length;
  const columnsSummary = ["Experiment", ...visibleLabels].join(", ");

  // The displayed string is already the dashboard's, so an edit keeps whichever
  // inherited tokens the user left alone.
  const searchValue = searchInherited
    ? (dashboardGlobalControls?.experimentSearchString ?? "")
    : block.experimentSearchString;
  const setSearchValue = (value: string) =>
    patchBlock(
      { experimentSearchString: value },
      searchInherited ? ["experimentSearchString"] : [],
    );

  // While inheriting, Revert is the way back — so no Clear all.
  const showClearAll =
    !searchInherited &&
    (experimentSearchIsActive(searchValue) ||
      !!block.startDateRange ||
      !!block.endDateRange);
  const clearAllFilters = () =>
    patchBlock({
      experimentSearchString: "",
      startDateRange: undefined,
      endDateRange: undefined,
    });

  // Start Date filters on the experiment's phase start (so running experiments
  // can be included); End Date filters on the phase end date.
  const dateFilters: ExtraFilter[] = [
    {
      key: "startDate",
      heading: "Start Date",
      isActive: !!block.startDateRange,
      label: block.startDateRange
        ? formatDateRange(block.startDateRange)
        : undefined,
      onAdd: () => setBlock({ ...block, startDateRange: DEFAULT_DATE_RANGE }),
      onRemove: () => setBlock({ ...block, startDateRange: undefined }),
      panelWidth: 300,
      keepOpenOnNestedPopper: true,
      renderPanel: () => (
        <BlockDateRangePicker
          value={block.startDateRange ?? DEFAULT_DATE_RANGE}
          onChange={(startDateRange) => setBlock({ ...block, startDateRange })}
        />
      ),
    },
    {
      key: "endDate",
      heading: "End Date",
      isActive: !!block.endDateRange,
      label: block.endDateRange
        ? formatDateRange(block.endDateRange)
        : undefined,
      onAdd: () => setBlock({ ...block, endDateRange: DEFAULT_DATE_RANGE }),
      onRemove: () => setBlock({ ...block, endDateRange: undefined }),
      panelWidth: 300,
      keepOpenOnNestedPopper: true,
      renderPanel: () => (
        <BlockDateRangePicker
          value={block.endDateRange ?? DEFAULT_DATE_RANGE}
          onChange={(endDateRange) => setBlock({ ...block, endDateRange })}
        />
      ),
    },
  ];

  return (
    <Flex direction="column" gap="5">
      {/* What this block calculates, not a filter — always the block's own. */}
      <SidebarSettingField label="Metric">
        <MetricSelector
          containerClassName="mb-0"
          value={block.metricId}
          onChange={(metricId) => patchBlock({ metricId })}
          includeFacts={true}
          projects={projects}
          placeholder="Select a metric..."
        />
      </SidebarSettingField>

      <SelectField
        label="Difference Type"
        labelClassName="font-weight-bold"
        containerClassName="mb-0"
        value={block.differenceType}
        onChange={(value) =>
          setBlock({
            ...block,
            differenceType: isDifferenceType(value) ? value : "absolute",
          })
        }
        options={DIFFERENCE_TYPE_OPTIONS}
        sort={false}
      />

      <SidebarSettingField
        label="Projects"
        accessory={
          projectsSet ? (
            <DashboardFilterInheritTag
              label="Projects"
              inherited={projectsInherited}
              onRevert={() => revert("projects")}
            />
          ) : undefined
        }
      >
        <MultiSelectField
          value={projectsValue}
          options={projectOptions}
          onChange={(v) =>
            patchBlock({ projects: v }, projectsInherited ? ["projects"] : [])
          }
          placeholder="All projects"
        />
      </SidebarSettingField>

      <SidebarSettingField
        label="Experiment filters"
        accessory={
          showClearAll || searchSet ? (
            <Flex align="center" gap="3">
              {showClearAll ? (
                <Link size="sm" color="red" onClick={clearAllFilters}>
                  Clear all
                </Link>
              ) : null}
              {searchSet ? (
                <DashboardFilterInheritTag
                  label="Experiment filters"
                  inherited={searchInherited}
                  onRevert={() => revert("experimentSearchString")}
                />
              ) : null}
            </Flex>
          ) : undefined
        }
      >
        {/* The start/end phase-date windows are this block's own — the dashboard
            filter never drives them. */}
        <SidebarExperimentFilters
          searchValue={searchValue}
          setSearchValue={setSearchValue}
          experiments={experiments}
          extraFilters={dateFilters}
          showProjectFilter={false}
        />
      </SidebarSettingField>

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
              size="sm"
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
            {/* The hidden count is already in the summary to the left, and this
                sidebar row wants a Link rather than the toolbar trigger. */}
            <ColumnSettingsButton
              columns={resolvedColumns.map((c) => ({
                id: c.id,
                label: c.label,
                visible: c.visible,
              }))}
              onChange={(columns) => setBlock({ ...block, columns })}
              note="The Experiment column is always shown."
              trigger={
                <Link size="sm" style={{ whiteSpace: "nowrap" }}>
                  <Flex align="center" gap="1">
                    <PiSlidersHorizontal />
                    Edit
                  </Flex>
                </Link>
              }
            />
          </Box>
        </Flex>
      </Box>
    </Flex>
  );
}
