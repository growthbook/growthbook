import React from "react";
import { Flex } from "@radix-ui/themes";
import {
  DashboardBlockInterfaceOrData,
  DashboardInterface,
  ExperimentsStatusBlockInterface,
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
  const setFollow = (
    key: "dateRange" | "projects" | "experimentSearchString",
    enabled: boolean,
  ) =>
    setBlock({
      ...block,
      globalControlSettings: {
        ...(block.globalControlSettings ?? {}),
        [key]: enabled,
      },
    });

  return (
    <Flex direction="column" gap="4">
      {/* Team Velocity does not support period comparison, so no Compare
          toggle is offered here. Granularity lives inside the date panel, which
          reflects the dashboard's when this block follows the date filter. */}
      <CompletedExperimentsFilterFields
        value={{ ...block, dateGranularity: block.dateGranularity || "auto" }}
        onChange={(patch) => setBlock({ ...block, ...patch })}
        availableProjects={projects}
        dashboardGlobalControls={dashboardGlobalControls}
        globalControlSettings={block.globalControlSettings}
        onToggleFollow={setFollow}
        showGranularity
      />
    </Flex>
  );
}
