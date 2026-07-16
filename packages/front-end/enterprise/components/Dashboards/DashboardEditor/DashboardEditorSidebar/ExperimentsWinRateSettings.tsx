import React from "react";
import { Flex } from "@radix-ui/themes";
import {
  DashboardBlockInterfaceOrData,
  DashboardInterface,
  ExperimentsWinRateBlockInterface,
  DashboardGlobalFilterKey,
} from "shared/enterprise";
import Switch from "@/ui/Switch";
import CompletedExperimentsFilterFields from "./CompletedExperimentsFilterFields";

interface Props {
  block: DashboardBlockInterfaceOrData<ExperimentsWinRateBlockInterface>;
  setBlock: React.Dispatch<
    DashboardBlockInterfaceOrData<ExperimentsWinRateBlockInterface>
  >;
  projects: string[];
  dashboardGlobalControls?: DashboardInterface["globalControls"];
}

export default function ExperimentsWinRateSettings({
  block,
  setBlock,
  projects,
  dashboardGlobalControls,
}: Props) {
  const onGlobalControlSettingChange = (
    key: DashboardGlobalFilterKey,
    enabled: boolean,
  ) =>
    setBlock({
      ...block,
      globalControlSettings: { ...block.globalControlSettings, [key]: enabled },
    });

  return (
    <Flex direction="column" gap="4">
      <CompletedExperimentsFilterFields
        value={block}
        onChange={(patch) => setBlock({ ...block, ...patch })}
        availableProjects={projects}
        dashboardGlobalControls={dashboardGlobalControls}
        globalControlSettings={block.globalControlSettings}
        onGlobalControlSettingChange={onGlobalControlSettingChange}
        comparisonEnabled={!!block.comparison?.enabled}
        previousTimeFrame={block.comparison?.previousTimeFrame}
        onPreviousTimeFrameChange={(previousTimeFrame) =>
          setBlock({
            ...block,
            comparison: {
              ...(block.comparison ?? {}),
              enabled: true,
              previousTimeFrame,
            },
          })
        }
        dateRangeAccessory={
          <Switch
            label="Compare"
            value={!!block.comparison?.enabled}
            onChange={(checked) =>
              setBlock({
                ...block,
                comparison: { ...(block.comparison ?? {}), enabled: checked },
              })
            }
          />
        }
      />

      <Switch
        label="Show per-project breakdown"
        value={block.showProjectBreakdown}
        onChange={(showProjectBreakdown) =>
          setBlock({ ...block, showProjectBreakdown })
        }
      />
    </Flex>
  );
}
