import React from "react";
import { Flex } from "@radix-ui/themes";
import {
  DashboardBlockInterfaceOrData,
  DashboardInterface,
  ExperimentsScaledImpactBlockInterface,
  blockUsesGlobalFilter,
  globalFilterIsSet,
} from "shared/enterprise";
import MetricSelector from "@/components/Experiment/MetricSelector";
import CompletedExperimentsFilterFields from "./CompletedExperimentsFilterFields";
import SidebarSettingField from "./SidebarSettingField";
import DashboardFollowToggle from "./DashboardFollowToggle";

interface Props {
  block: DashboardBlockInterfaceOrData<ExperimentsScaledImpactBlockInterface>;
  setBlock: React.Dispatch<
    DashboardBlockInterfaceOrData<ExperimentsScaledImpactBlockInterface>
  >;
  projects: string[];
  dashboardGlobalControls?: DashboardInterface["globalControls"];
}

export default function ExperimentsScaledImpactSettings({
  block,
  setBlock,
  projects,
  dashboardGlobalControls,
}: Props) {
  const setFollow = (
    key: "metricId" | "dateRange" | "projects" | "experimentSearchString",
    enabled: boolean,
  ) =>
    setBlock({
      ...block,
      globalControlSettings: {
        ...(block.globalControlSettings ?? {}),
        [key]: enabled,
      },
    });

  const metricSet = globalFilterIsSet(dashboardGlobalControls, "metricId");
  const metricFollowing = blockUsesGlobalFilter(block, "metricId");
  const metricControlled = metricFollowing && metricSet;

  const dashboardMetricId = dashboardGlobalControls?.metricId;
  const metricValue =
    metricControlled && dashboardMetricId ? dashboardMetricId : block.metricId;

  return (
    <Flex direction="column" gap="5">
      <SidebarSettingField
        label="Metric"
        accessory={
          metricSet ? (
            <DashboardFollowToggle
              label="Use dashboard metric"
              tooltip="Follow the dashboard's metric instead of this block's own. Turn off to choose a metric just for this block."
              value={metricFollowing}
              onChange={(enabled) => setFollow("metricId", enabled)}
            />
          ) : undefined
        }
      >
        <MetricSelector
          value={metricValue}
          onChange={(metricId) => setBlock({ ...block, metricId })}
          includeFacts={true}
          projects={projects}
          placeholder="Select a metric..."
          disabled={metricControlled}
        />
      </SidebarSettingField>

      <CompletedExperimentsFilterFields
        value={block}
        onChange={(patch) => setBlock({ ...block, ...patch })}
        availableProjects={projects}
        dashboardGlobalControls={dashboardGlobalControls}
        globalControlSettings={block.globalControlSettings}
        onToggleFollow={setFollow}
      />
    </Flex>
  );
}
