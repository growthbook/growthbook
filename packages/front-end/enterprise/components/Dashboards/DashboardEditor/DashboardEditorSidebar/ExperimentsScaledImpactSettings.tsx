import React from "react";
import { Flex } from "@radix-ui/themes";
import {
  DashboardBlockInterfaceOrData,
  DashboardInterface,
  ExperimentsScaledImpactBlockInterface,
  experimentBlockFollowsGlobalFilters,
  experimentBlockHasActiveGlobalFilters,
  globalFilterIsSet,
  setExperimentBlockGlobalFilterFollowing,
} from "shared/enterprise";
import MetricSelector from "@/components/Experiment/MetricSelector";
import CompletedExperimentsFilterFields from "./CompletedExperimentsFilterFields";
import SidebarSettingField from "./SidebarSettingField";
import DashboardExperimentFilterToggle from "./DashboardExperimentFilterToggle";

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
  const dashboardMetricId = dashboardGlobalControls?.metricId;
  const metricValue =
    metricControlled && dashboardMetricId ? dashboardMetricId : block.metricId;

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
        <MetricSelector
          value={metricValue}
          onChange={(metricId) => setBlock({ ...block, metricId })}
          includeFacts={true}
          projects={projects}
          placeholder="Select a metric..."
          disabled={following}
        />
      </SidebarSettingField>

      <CompletedExperimentsFilterFields
        value={block}
        onChange={(patch) => setBlock({ ...block, ...patch })}
        availableProjects={projects}
        dashboardGlobalControls={dashboardGlobalControls}
        following={following}
      />
    </Flex>
  );
}
