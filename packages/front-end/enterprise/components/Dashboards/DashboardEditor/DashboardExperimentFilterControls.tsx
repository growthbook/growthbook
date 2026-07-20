import { useMemo, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiCaretDown } from "react-icons/pi";
import { DashboardInterface } from "shared/enterprise";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useExperiments } from "@/hooks/useExperiments";
import SidebarExperimentFilters, {
  EXPERIMENT_FILTER_KEYS,
} from "@/components/Search/SidebarExperimentFilters";
import { transformQuery } from "@/services/search";
import { Popover } from "@/ui/Popover";
import Button from "@/ui/Button";
import Text from "@/ui/Text";
import DashboardChecklistFilter, {
  ChecklistOption,
} from "./DashboardChecklistFilter";
import FilterCountBadge from "./FilterCountBadge";

type GlobalControls = DashboardInterface["globalControls"];

interface Props {
  globalControls: GlobalControls;
  showProjects: boolean;
  showMetric: boolean;
  showExperimentSearch: boolean;
  disabled?: boolean;
  // Restrict metric/project options to the dashboard's projects (empty = all).
  projects: string[];
  onChange: (patch: Partial<NonNullable<GlobalControls>>) => void;
}

export default function DashboardExperimentFilterControls({
  globalControls,
  showProjects,
  showMetric,
  showExperimentSearch,
  disabled,
  projects,
  onChange,
}: Props) {
  const {
    projects: allProjects,
    metrics,
    factMetrics,
    getExperimentMetricById,
  } = useDefinitions();
  const { experiments } = useExperiments();
  const [experimentsOpen, setExperimentsOpen] = useState(false);

  // Projects ------------------------------------------------------------------
  const projectOptions: ChecklistOption[] = useMemo(
    () =>
      (projects.length > 0
        ? allProjects.filter((p) => projects.includes(p.id))
        : allProjects
      ).map((p) => ({ label: p.name, value: p.id })),
    [allProjects, projects],
  );
  const selectedProjects = globalControls?.projects ?? [];

  // Metric --------------------------------------------------------------------
  const metricOptions: ChecklistOption[] = useMemo(() => {
    const inScope = (m: { projects?: string[] }) =>
      projects.length === 0 ||
      !m.projects?.length ||
      projects.some((p) => m.projects?.includes(p));
    const seen = new Set<string>();
    return [...metrics, ...factMetrics]
      .filter(inScope)
      .map((m) => ({ label: m.name, value: m.id }))
      .filter((o) => (seen.has(o.value) ? false : (seen.add(o.value), true)))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [metrics, factMetrics, projects]);
  const metricId = globalControls?.metricId ?? "";

  // Experiments filter --------------------------------------------------------
  const searchValue = globalControls?.experimentSearchString ?? "";
  // Count of distinct filter categories applied (e.g. status + tag = 2). The
  // free-text search term counts as one filter too.
  const experimentFilterCount = useMemo(() => {
    if (!searchValue.trim()) return 0;
    const { searchTerm, syntaxFilters } = transformQuery(
      searchValue,
      EXPERIMENT_FILTER_KEYS,
    );
    const categories = new Set(syntaxFilters.map((f) => f.field)).size;
    return categories + (searchTerm.trim() ? 1 : 0);
  }, [searchValue]);

  // Keep the popover open when interacting with a nested Radix popper (the
  // "Add filter" menu and each category panel render in their own portals).
  const keepOpenOnNestedPopper = (e: { target: EventTarget | null }) => {
    const target = e.target as HTMLElement | null;
    if (target?.closest("[data-radix-popper-content-wrapper]")) {
      (e as unknown as Event).preventDefault();
    }
  };

  if (!showProjects && !showMetric && !showExperimentSearch) return null;

  return (
    <>
      {showProjects ? (
        <DashboardChecklistFilter
          label="Projects"
          options={projectOptions}
          value={selectedProjects}
          onChange={(v) => onChange({ projects: v })}
          disabled={disabled}
          searchPlaceholder="Search projects..."
          emptyText="No projects found"
        />
      ) : null}

      {showMetric ? (
        <DashboardChecklistFilter
          label="Metrics"
          selectedLabel={
            metricId
              ? (getExperimentMetricById(metricId)?.name ?? "Metric")
              : undefined
          }
          maxLabelWidth={200}
          options={metricOptions}
          value={metricId ? [metricId] : []}
          onChange={(v) => onChange({ metricId: v[0] })}
          singleSelect
          variant="list"
          showCount={false}
          disabled={disabled}
          searchPlaceholder="Search metrics..."
          emptyText="No metrics found"
        />
      ) : null}

      {showExperimentSearch ? (
        <Popover
          open={experimentsOpen}
          onOpenChange={setExperimentsOpen}
          trigger={
            <Button
              variant="outline"
              size="sm"
              disabled={disabled}
              style={{ justifyContent: "space-between" }}
            >
              <Flex align="center" gap="2">
                <span>Filters</span>
                {experimentFilterCount > 0 ? (
                  <FilterCountBadge count={experimentFilterCount} />
                ) : null}
                <PiCaretDown aria-hidden />
              </Flex>
            </Button>
          }
          align="end"
          showArrow={false}
          onInteractOutside={keepOpenOnNestedPopper}
          contentStyle={{ padding: "16px 20px", width: 340 }}
          content={
            <Box>
              <Box mb="1">
                <Text weight="semibold" size="medium">
                  Experiment Filters
                </Text>
              </Box>
              <Box mb="3">
                <Text size="small" color="text-low">
                  Applies to all blocks containing experiments
                </Text>
              </Box>
              <SidebarExperimentFilters
                searchValue={searchValue}
                setSearchValue={(value) =>
                  onChange({ experimentSearchString: value || undefined })
                }
                experiments={experiments}
                showProjectFilter={false}
              />
            </Box>
          }
        />
      ) : null}
    </>
  );
}
