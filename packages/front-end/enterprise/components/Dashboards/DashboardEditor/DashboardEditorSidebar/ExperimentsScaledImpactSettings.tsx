import React from "react";
import { Flex } from "@radix-ui/themes";
import {
  DashboardBlockInterfaceOrData,
  DashboardInterface,
  ExperimentsScaledImpactBlockInterface,
  withBlockGlobalFilterFollowing,
} from "shared/enterprise";
import MetricSelector from "@/components/Experiment/MetricSelector";
import CompletedExperimentsFilterFields from "./CompletedExperimentsFilterFields";
import SidebarSettingField from "./SidebarSettingField";

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
  return (
    <Flex direction="column" gap="5">
      {/* What this block calculates, not a filter — always the block's own. */}
      <SidebarSettingField label="Metric">
        <MetricSelector
          value={block.metricId}
          onChange={(metricId) => setBlock({ ...block, metricId })}
          includeFacts={true}
          projects={projects}
          placeholder="Select a metric..."
        />
      </SidebarSettingField>

      <CompletedExperimentsFilterFields
        value={block}
        onChange={(patch, claim = []) =>
          setBlock(
            withBlockGlobalFilterFollowing(
              { ...block, ...patch },
              claim,
              false,
            ),
          )
        }
        onRevert={(key) =>
          setBlock(withBlockGlobalFilterFollowing(block, [key], true))
        }
        availableProjects={projects}
        dashboardGlobalControls={dashboardGlobalControls}
        globalControlSettings={block.globalControlSettings}
      />
    </Flex>
  );
}
