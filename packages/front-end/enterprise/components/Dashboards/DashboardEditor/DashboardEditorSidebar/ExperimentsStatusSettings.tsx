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
    <Flex direction="column" gap="5">
      <CompletedExperimentsFilterFields
        value={{
          dateRange: block.dateRange,
          startDate: block.startDate,
          endDate: block.endDate,
          projects: block.projects,
        }}
        onChange={(patch) => setBlock({ ...block, ...patch })}
        availableProjects={projects}
      />
    </Flex>
  );
}
