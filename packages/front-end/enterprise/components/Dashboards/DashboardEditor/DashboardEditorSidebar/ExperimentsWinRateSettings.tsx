import React from "react";
import { Flex } from "@radix-ui/themes";
import {
  DashboardBlockInterfaceOrData,
  DashboardInterface,
  ExperimentsWinRateBlockInterface,
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
      {/* Compare lives inside the date panel, alongside the range it compares
          against; the field's label row carries the inherit control instead. */}
      <CompletedExperimentsFilterFields
        value={block}
        onChange={(patch) => setBlock({ ...block, ...patch })}
        availableProjects={projects}
        dashboardGlobalControls={dashboardGlobalControls}
        globalControlSettings={block.globalControlSettings}
        onToggleFollow={setFollow}
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
