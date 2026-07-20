import {
  DashboardBlockInterfaceOrData,
  DashboardInterface,
  MetricExperimentsBlockInterface,
  isDifferenceType,
  DIFFERENCE_TYPE_OPTIONS,
  globalFilterIsSet,
  experimentBlockFollowsGlobalFilters,
  experimentBlockHasActiveGlobalFilters,
  setExperimentBlockGlobalFilterFollowing,
} from "shared/enterprise";
import { ExplorationDateRange } from "shared/validators";
import React, { useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiSlidersHorizontal } from "react-icons/pi";
import Text from "@/ui/Text";
import Link from "@/ui/Link";
import { Popover } from "@/ui/Popover";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useExperiments } from "@/hooks/useExperiments";
import SidebarExperimentFilters, {
  ExtraFilter,
} from "@/components/Search/SidebarExperimentFilters";
import MetricSelector from "@/components/Experiment/MetricSelector";
import SelectField from "@/components/Forms/SelectField";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import { resolveMetricExperimentColumns } from "@/components/MetricExperiments/MetricExperiments";
import MetricExperimentsColumnSettings from "./MetricExperimentsColumnSettings";
import BlockDateRangePicker, {
  PREDEFINED_LABELS,
} from "./BlockDateRangePicker";
import SidebarSettingField from "./SidebarSettingField";
import DashboardExperimentFilterToggle from "./DashboardExperimentFilterToggle";

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
  return PREDEFINED_LABELS[dr.predefined];
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
  const [columnsOpen, setColumnsOpen] = useState(false);

  const hasActiveFilters = experimentBlockHasActiveGlobalFilters(
    block,
    dashboardGlobalControls,
  );
  const following = experimentBlockFollowsGlobalFilters(
    block,
    dashboardGlobalControls,
  );

  const metricControlled =
    following && globalFilterIsSet(dashboardGlobalControls, "metricId");
  const projectsControlled =
    following && globalFilterIsSet(dashboardGlobalControls, "projects");
  const experimentControlled =
    following &&
    globalFilterIsSet(dashboardGlobalControls, "experimentSearchString");

  const dashboardProjects = dashboardGlobalControls?.projects ?? [];

  const projectOptions = (
    projects.length > 0
      ? allProjects.filter((p) => projects.includes(p.id))
      : allProjects
  ).map((p) => ({ label: p.name, value: p.id }));

  const metricValue =
    metricControlled && dashboardGlobalControls?.metricId
      ? dashboardGlobalControls.metricId
      : block.metricId;
  const projectsValue = projectsControlled ? dashboardProjects : block.projects;

  const resolvedColumns = resolveMetricExperimentColumns(
    block.columns,
    block.bandits,
  );
  const visibleLabels = resolvedColumns
    .filter((c) => c.visible)
    .map((c) => c.label);
  const hiddenCount = resolvedColumns.length - visibleLabels.length;
  const columnsSummary = ["Experiment", ...visibleLabels].join(", ");

  // When following the dashboard, the experiment text filter is locked; it shows
  // the dashboard value when one is set, otherwise the block's own value
  // read-only. The block's own start/end phase-date windows below stay editable
  // (they are never driven by the dashboard filter).
  const searchValue = experimentControlled
    ? (dashboardGlobalControls?.experimentSearchString ?? "")
    : block.experimentSearchString;
  const setSearchValue = following
    ? () => {}
    : (value: string) => setBlock({ ...block, experimentSearchString: value });

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
      {hasActiveFilters ? (
        <DashboardExperimentFilterToggle
          value={following}
          onChange={(enabled) =>
            setBlock({
              ...block,
              globalControlSettings: setExperimentBlockGlobalFilterFollowing(
                block,
                dashboardGlobalControls,
                enabled,
              ),
            })
          }
        />
      ) : null}

      <SidebarSettingField label="Metric">
        {/* The metric is a required field, so it's only locked when the
            dashboard actually supplies one. When following without a dashboard
            metric, the block still needs its own metric selected here. */}
        <MetricSelector
          containerClassName="mb-0"
          value={metricValue}
          onChange={(metricId) => setBlock({ ...block, metricId })}
          includeFacts={true}
          projects={projects}
          placeholder="Select a metric..."
          disabled={metricControlled}
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

      <SidebarSettingField label="Projects Filter">
        <MultiSelectField
          value={projectsValue}
          options={projectOptions}
          onChange={(v) => setBlock({ ...block, projects: v })}
          placeholder="All projects"
          disabled={following}
        />
      </SidebarSettingField>

      <Box>
        <Box mb="2">
          <Text weight="semibold">Filter Experiments</Text>
        </Box>
        {/* The start/end phase-date windows below are specific to this block and
            are never driven by the dashboard filter, so they stay editable even
            when the experiment text filter follows the dashboard. */}
        <SidebarExperimentFilters
          searchValue={searchValue}
          setSearchValue={setSearchValue}
          experiments={experiments}
          extraFilters={dateFilters}
          showProjectFilter={false}
          searchDisabled={following}
        />
      </Box>

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
              size="small"
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
            <Popover
              open={columnsOpen}
              onOpenChange={setColumnsOpen}
              align="end"
              trigger={
                <Link size="1" style={{ whiteSpace: "nowrap" }}>
                  <Flex align="center" gap="1">
                    <PiSlidersHorizontal />
                    Edit
                  </Flex>
                </Link>
              }
              content={
                <Box style={{ width: 260 }}>
                  <Box mb="2">
                    <Text size="small" color="text-low">
                      Drag to reorder or toggle visibility. The Experiment
                      column is always shown.
                    </Text>
                  </Box>
                  <MetricExperimentsColumnSettings
                    columns={resolvedColumns.map((c) => ({
                      id: c.id,
                      label: c.label,
                      visible: c.visible,
                    }))}
                    onChange={(columns) => setBlock({ ...block, columns })}
                  />
                </Box>
              }
            />
          </Box>
        </Flex>
      </Box>
    </Flex>
  );
}
