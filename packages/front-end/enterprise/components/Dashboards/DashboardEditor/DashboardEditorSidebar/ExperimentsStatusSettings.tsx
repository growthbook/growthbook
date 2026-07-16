import React from "react";
import { Box, Flex } from "@radix-ui/themes";
import {
  DashboardBlockInterfaceOrData,
  DashboardInterface,
  ExperimentsStatusBlockInterface,
  DashboardGlobalFilterKey,
  getDateGranularity,
  getEffectiveExperimentBlock,
  globalFilterIsSet,
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
  dashboardGlobalControls?: DashboardInterface["globalControls"];
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

  // When the block follows the dashboard date filter, its granularity is driven
  // by the dashboard too, so reflect the effective values and lock the control.
  const dateControlled =
    globalFilterIsSet(dashboardGlobalControls, "dateRange") &&
    block.globalControlSettings?.dateRange === true;
  const effectiveBlock = getEffectiveExperimentBlock(block, {
    globalControls: dashboardGlobalControls,
  });
  const window = resolveCompletedExperimentsFilters(effectiveBlock);
  const granularity =
    (dateControlled
      ? dashboardGlobalControls?.dateGranularity
      : block.dateGranularity) || "auto";
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
        dashboardGlobalControls={dashboardGlobalControls}
        globalControlSettings={block.globalControlSettings}
        onGlobalControlSettingChange={onGlobalControlSettingChange}
        afterDateRange={
          <Box>
            <Box mb="2">
              <Text weight="semibold">Date Granularity</Text>
            </Box>
            <Select
              size="2"
              value={granularity}
              placeholder="Granularity"
              disabled={dateControlled}
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
