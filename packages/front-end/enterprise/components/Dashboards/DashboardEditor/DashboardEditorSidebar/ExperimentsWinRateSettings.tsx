import React from "react";
import { Flex } from "@radix-ui/themes";
import {
  DashboardBlockInterfaceOrData,
  ExperimentsWinRateBlockInterface,
} from "shared/enterprise";
import Checkbox from "@/ui/Checkbox";
import CompletedExperimentsFilterFields from "./CompletedExperimentsFilterFields";

interface Props {
  block: DashboardBlockInterfaceOrData<ExperimentsWinRateBlockInterface>;
  setBlock: React.Dispatch<
    DashboardBlockInterfaceOrData<ExperimentsWinRateBlockInterface>
  >;
  projects: string[];
}

export default function ExperimentsWinRateSettings({
  block,
  setBlock,
  projects,
}: Props) {
  return (
    <Flex direction="column" gap="5">
      <CompletedExperimentsFilterFields
        value={block}
        onChange={(patch) => setBlock({ ...block, ...patch })}
        availableProjects={projects}
      />

      <Checkbox
        label="Show per-project breakdown"
        value={block.showProjectBreakdown}
        setValue={(showProjectBreakdown) =>
          setBlock({ ...block, showProjectBreakdown })
        }
      />
    </Flex>
  );
}
