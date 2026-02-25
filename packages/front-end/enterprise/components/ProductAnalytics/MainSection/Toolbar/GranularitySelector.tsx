import React from "react";
import { dateGranularity } from "shared/validators";
import {
  calculateProductAnalyticsDateRange,
  getDateGranularity,
} from "shared/enterprise";
import { Flex } from "@radix-ui/themes";
import { Select, SelectItem } from "@/ui/Select";
import { useExplorerContext } from "@/enterprise/components/ProductAnalytics/ExplorerContext";
import Badge from "@/ui/Badge";
import Text from "@/ui/Text";

const dateGranularityLabels: Record<(typeof dateGranularity)[number], string> =
  {
    auto: "Auto",
    hour: "By Hour",
    day: "By Day",
    week: "By Week",
    month: "By Month",
    year: "By Year",
  };

export default function GranularitySelector() {
  const { draftExploreState, setDraftExploreState } = useExplorerContext();

  const dateDimension = draftExploreState.dimensions.find(
    (d) => d.dimensionType === "date",
  );
  const granularity = dateDimension?.dateGranularity || "day";

  const dateRange = calculateProductAnalyticsDateRange(
    draftExploreState.dateRange,
  );
  const effectiveGranularity = getDateGranularity(granularity, dateRange);

  return (
    <Select
      size="2"
      value={granularity}
      placeholder="Granularity"
      setValue={(v) => {
        setDraftExploreState((prev) => ({
          ...prev,
          dimensions: prev.dimensions.map((d) =>
            d.dimensionType === "date"
              ? {
                  ...d,
                  dateGranularity: v as (typeof dateGranularity)[number],
                }
              : d,
          ),
        }));
      }}
    >
      {dateGranularity.map((g) => (
        <SelectItem key={g} value={g}>
          {g === "auto" ? (
            <Flex direction="row" align="center" gap="2">
              <Text>{dateGranularityLabels[effectiveGranularity]}</Text>
              <Badge label="Auto" />
            </Flex>
          ) : (
            dateGranularityLabels[g]
          )}
        </SelectItem>
      ))}
    </Select>
  );
}
