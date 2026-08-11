import React from "react";
import { Flex } from "@radix-ui/themes";
import {
  DashboardBlockInterfaceOrData,
  DashboardInterface,
  ExperimentsScaledImpactBlockInterface,
  blockUsesGlobalFilter,
  globalFilterIsSet,
  withBlockGlobalFilterFollowing,
} from "shared/enterprise";
import MetricSelector from "@/components/Experiment/MetricSelector";
import CompletedExperimentsFilterFields from "./CompletedExperimentsFilterFields";
import SidebarSettingField from "./SidebarSettingField";
import DashboardFilterInheritTag from "./DashboardFilterInheritTag";

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
  const metricSet = globalFilterIsSet(dashboardGlobalControls, "metricId");
  const metricInherited = blockUsesGlobalFilter(block, "metricId") && metricSet;

  const dashboardMetricId = dashboardGlobalControls?.metricId;
  const metricValue =
    metricInherited && dashboardMetricId ? dashboardMetricId : block.metricId;

  return (
    <Flex direction="column" gap="5">
      <SidebarSettingField
        label="Metric"
        accessory={
          metricSet ? (
            <DashboardFilterInheritTag
              label="Metric"
              inherited={metricInherited}
              onRevert={() =>
                setBlock(
                  withBlockGlobalFilterFollowing(block, ["metricId"], true),
                )
              }
            />
          ) : undefined
        }
      >
        <MetricSelector
          value={metricValue}
          onChange={(metricId) =>
            setBlock(
              withBlockGlobalFilterFollowing(
                { ...block, metricId },
                metricInherited ? ["metricId"] : [],
                false,
              ),
            )
          }
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
