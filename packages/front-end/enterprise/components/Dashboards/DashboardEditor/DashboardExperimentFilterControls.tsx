import { ReactNode, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiCaretDown, PiFunnel, PiFlask, PiChartLineUp } from "react-icons/pi";
import { DashboardInterface } from "shared/enterprise";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useExperiments } from "@/hooks/useExperiments";
import MetricSelector from "@/components/Experiment/MetricSelector";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import SidebarExperimentFilters from "@/components/Search/SidebarExperimentFilters";
import { Popover } from "@/ui/Popover";
import Button from "@/ui/Button";
import Text from "@/ui/Text";

type GlobalControls = DashboardInterface["globalControls"];

// A single dropdown control in the dashboard filter bar. Mirrors the styling of
// DashboardDateControlsDropdown so the whole bar reads as one control group.
function FilterControl({
  label,
  icon,
  disabled,
  width = 300,
  children,
}: {
  label: string;
  icon: ReactNode;
  disabled?: boolean;
  width?: number;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          icon={icon}
          iconPosition="left"
          style={{ justifyContent: "space-between" }}
        >
          <Flex align="center" gap="2" justify="between" width="100%">
            <span>{label}</span>
            <PiCaretDown aria-hidden />
          </Flex>
        </Button>
      }
      align="end"
      showArrow={false}
      contentStyle={{ padding: "16px 20px", width }}
      content={children}
    />
  );
}

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
  const { projects: allProjects, getExperimentMetricById } = useDefinitions();
  const { experiments } = useExperiments();

  const projectOptions = (
    projects.length > 0
      ? allProjects.filter((p) => projects.includes(p.id))
      : allProjects
  ).map((p) => ({ label: p.name, value: p.id }));

  const selectedProjects = globalControls?.projects ?? [];
  const projectsLabel =
    selectedProjects.length === 0
      ? "All projects"
      : selectedProjects.length === 1
        ? (projectOptions.find((p) => p.value === selectedProjects[0])?.label ??
          "1 project")
        : `${selectedProjects.length} projects`;

  const metricId = globalControls?.metricId ?? "";
  const metricLabel = metricId
    ? (getExperimentMetricById(metricId)?.name ?? "Metric")
    : "Chart Default";

  const searchValue = globalControls?.experimentSearchString ?? "";
  const experimentLabel = searchValue ? "Filtered" : "All experiments";

  return (
    <>
      {showProjects ? (
        <FilterControl
          label={projectsLabel}
          icon={<PiFunnel aria-hidden />}
          disabled={disabled}
        >
          <Box>
            <Box mb="2">
              <Text weight="medium" size="medium">
                Projects Filter
              </Text>
            </Box>
            <MultiSelectField
              value={selectedProjects}
              options={projectOptions}
              onChange={(v) => onChange({ projects: v })}
              placeholder="All projects"
              disabled={disabled}
            />
          </Box>
        </FilterControl>
      ) : null}

      {showMetric ? (
        <FilterControl
          label={metricLabel}
          icon={<PiChartLineUp aria-hidden />}
          disabled={disabled}
        >
          <Box>
            <Box mb="2">
              <Text weight="medium" size="medium">
                Metric Filter
              </Text>
            </Box>
            <MetricSelector
              value={metricId}
              onChange={(value) => onChange({ metricId: value || undefined })}
              includeFacts={true}
              projects={projects}
              placeholder="Chart default"
              disabled={disabled}
            />
          </Box>
        </FilterControl>
      ) : null}

      {showExperimentSearch ? (
        <FilterControl
          label={experimentLabel}
          icon={<PiFlask aria-hidden />}
          disabled={disabled}
          width={320}
        >
          <Box>
            <Box mb="2">
              <Text weight="medium" size="medium">
                Filter Experiments
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
        </FilterControl>
      ) : null}
    </>
  );
}
