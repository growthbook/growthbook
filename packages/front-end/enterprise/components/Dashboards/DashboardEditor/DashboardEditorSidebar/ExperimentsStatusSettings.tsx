import React from "react";
import { Flex } from "@radix-ui/themes";
import {
  DashboardBlockInterfaceOrData,
  ExperimentsStatusBlockInterface,
} from "shared/enterprise";
import CompletedExperimentsFilterFields from "./CompletedExperimentsFilterFields";

interface Props {
  block: DashboardBlockInterfaceOrData<ExperimentsStatusBlockInterface>;
  setBlock: React.Dispatch<
    DashboardBlockInterfaceOrData<ExperimentsStatusBlockInterface>
  >;
  projects: string[];
}

export default function ExperimentsStatusSettings({
  block,
  setBlock,
  projects,
}: Props) {
  return (
    <Flex direction="column" gap="4">
      {/* Team Velocity does not support period comparison, so no Compare
          toggle is offered here. */}
      <CompletedExperimentsFilterFields
        value={block}
        onChange={(patch) => setBlock({ ...block, ...patch })}
        availableProjects={projects}
        granularity={block.dateGranularity || "auto"}
        onGranularityChange={(dateGranularity) =>
          setBlock({ ...block, dateGranularity })
        }
      />
    </Flex>
  );
}
