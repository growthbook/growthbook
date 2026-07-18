import React from "react";
import { Flex } from "@radix-ui/themes";
import {
  DashboardBlockInterfaceOrData,
  DashboardInterface,
  ExperimentsWinRateBlockInterface,
  experimentBlockFollowsGlobalFilters,
  experimentBlockHasActiveGlobalFilters,
  setExperimentBlockGlobalFilterFollowing,
} from "shared/enterprise";
import Switch from "@/ui/Switch";
import CompletedExperimentsFilterFields from "./CompletedExperimentsFilterFields";
import DashboardExperimentFilterToggle from "./DashboardExperimentFilterToggle";

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
  const hasActiveFilters = experimentBlockHasActiveGlobalFilters(
    block,
    dashboardGlobalControls,
  );
  const following = experimentBlockFollowsGlobalFilters(
    block,
    dashboardGlobalControls,
  );

  return (
    <Flex direction="column" gap="4">
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

      <CompletedExperimentsFilterFields
        value={block}
        onChange={(patch) => setBlock({ ...block, ...patch })}
        availableProjects={projects}
        dashboardGlobalControls={dashboardGlobalControls}
        following={following}
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
