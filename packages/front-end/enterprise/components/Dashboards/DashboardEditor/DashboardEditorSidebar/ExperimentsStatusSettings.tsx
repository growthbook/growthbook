import React from "react";
import { Flex } from "@radix-ui/themes";
import {
  DashboardBlockInterfaceOrData,
  DashboardInterface,
  ExperimentsStatusBlockInterface,
  withBlockGlobalFilterFollowing,
} from "shared/enterprise";
import CompletedExperimentsFilterFields from "./CompletedExperimentsFilterFields";

interface Props {
  block: DashboardBlockInterfaceOrData<ExperimentsStatusBlockInterface>;
  setBlock: React.Dispatch<
    DashboardBlockInterfaceOrData<ExperimentsStatusBlockInterface>
  >;
  projects: string[];
  dashboardGlobalControls?: DashboardInterface["globalControls"];
}

export default function ExperimentsStatusSettings({
  block,
  setBlock,
  projects,
  dashboardGlobalControls,
}: Props) {
  return (
    <Flex direction="column" gap="4">
      {/* Team Velocity does not support period comparison, so no Compare
          toggle is offered here. Granularity lives inside the date panel, which
          reflects the dashboard's while this block inherits the date filter. */}
      <CompletedExperimentsFilterFields
        value={{ ...block, dateGranularity: block.dateGranularity || "auto" }}
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
        showGranularity
      />
    </Flex>
  );
}
