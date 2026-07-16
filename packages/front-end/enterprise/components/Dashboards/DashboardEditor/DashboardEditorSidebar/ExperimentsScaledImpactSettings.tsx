import React from "react";
import { Flex } from "@radix-ui/themes";
import {
  DashboardBlockInterfaceOrData,
  DashboardInterface,
  ExperimentsScaledImpactBlockInterface,
  DashboardGlobalFilterKey,
  globalFilterIsSet,
} from "shared/enterprise";
import MetricSelector from "@/components/Experiment/MetricSelector";
import { useDefinitions } from "@/services/DefinitionsContext";
import CompletedExperimentsFilterFields from "./CompletedExperimentsFilterFields";
import GlobalControlField from "./GlobalControlField";

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
  const { getExperimentMetricById } = useDefinitions();

  const onGlobalControlSettingChange = (
    key: DashboardGlobalFilterKey,
    enabled: boolean,
  ) =>
    setBlock({
      ...block,
      globalControlSettings: { ...block.globalControlSettings, [key]: enabled },
    });

  const metricControlled =
    globalFilterIsSet(dashboardGlobalControls, "metricId") &&
    block.globalControlSettings?.metricId === true;
  const dashboardMetricId = dashboardGlobalControls?.metricId;

  return (
    <Flex direction="column" gap="5">
      <GlobalControlField
        label="Metric"
        globalActive={globalFilterIsSet(dashboardGlobalControls, "metricId")}
        controlled={metricControlled}
        onToggle={(enabled) =>
          onGlobalControlSettingChange("metricId", enabled)
        }
        controlledSummary={
          dashboardMetricId
            ? (getExperimentMetricById(dashboardMetricId)?.name ?? "Metric")
            : ""
        }
      >
        <MetricSelector
          value={block.metricId}
          onChange={(metricId) => setBlock({ ...block, metricId })}
          includeFacts={true}
          projects={projects}
          placeholder="Select a metric..."
        />
      </GlobalControlField>

      <CompletedExperimentsFilterFields
        value={block}
        onChange={(patch) => setBlock({ ...block, ...patch })}
        availableProjects={projects}
        dashboardGlobalControls={dashboardGlobalControls}
        globalControlSettings={block.globalControlSettings}
        onGlobalControlSettingChange={onGlobalControlSettingChange}
      />
    </Flex>
  );
}
