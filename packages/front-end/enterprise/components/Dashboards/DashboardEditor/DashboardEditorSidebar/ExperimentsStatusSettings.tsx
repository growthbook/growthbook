import React from "react";
import { Box, Flex } from "@radix-ui/themes";
import {
  DashboardBlockInterfaceOrData,
  ExperimentsStatusBlockInterface,
  getDateGranularity,
  resolveCompletedExperimentsFilters,
} from "shared/enterprise";
import { dateGranularity } from "shared/validators";
import { Select, SelectItem } from "@/ui/Select";
import Badge from "@/ui/Badge";
import Text from "@/ui/Text";
import { getValidDateGranularities } from "@/enterprise/components/ProductAnalytics/util";
import CompletedExperimentsFilterFields from "./CompletedExperimentsFilterFields";

interface Props {
  block: DashboardBlockInterfaceOrData<ExperimentsStatusBlockInterface>;
  setBlock: React.Dispatch<
    DashboardBlockInterfaceOrData<ExperimentsStatusBlockInterface>
  >;
  projects: string[];
}

const dateGranularityLabels: Record<(typeof dateGranularity)[number], string> =
  {
    auto: "Auto",
    hour: "By Hour",
    day: "By Day",
    week: "By Week",
    month: "By Month",
    year: "By Year",
  };

export default function ExperimentsStatusSettings({
  block,
  setBlock,
  projects,
}: Props) {
  const window = resolveCompletedExperimentsFilters(block);
  const granularity = block.dateGranularity || "auto";
  const autoGranularity = getDateGranularity("auto", window);
  const validGranularities = getValidDateGranularities(window);

  return (
    <Flex direction="column" gap="4">
      {/* Team Velocity does not support period comparison, so no Compare
          toggle is offered here. */}
      <CompletedExperimentsFilterFields
        value={block}
        onChange={(patch) => setBlock({ ...block, ...patch })}
        availableProjects={projects}
        afterDateRange={
          <Box>
            <Box mb="2">
              <Text weight="semibold">Date Granularity</Text>
            </Box>
            <Select
              size="small"
              value={granularity}
              placeholder="Granularity"
              setValue={(v) =>
                setBlock({
                  ...block,
                  dateGranularity: v as (typeof dateGranularity)[number],
                })
              }
            >
              {validGranularities.map((g) => (
                <SelectItem key={g} value={g}>
                  {g === "auto" ? (
                    <Flex direction="row" align="center" gap="2">
                      <Text>{dateGranularityLabels[autoGranularity]}</Text>
                      <Badge label="Auto" />
                    </Flex>
                  ) : (
                    dateGranularityLabels[g]
                  )}
                </SelectItem>
              ))}
            </Select>
          </Box>
        }
      />
    </Flex>
  );
}
