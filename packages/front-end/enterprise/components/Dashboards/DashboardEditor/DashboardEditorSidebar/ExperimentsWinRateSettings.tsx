import React from "react";
import { Flex } from "@radix-ui/themes";
import {
  DashboardBlockInterfaceOrData,
  DashboardInterface,
  ExperimentsWinRateBlockInterface,
  withBlockGlobalFilterFollowing,
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
  return (
    <Flex direction="column" gap="4">
      {/* Compare lives inside the date panel, alongside the range it compares
          against; the field's label row carries the inheritance tag instead. */}
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
        showCompare
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
