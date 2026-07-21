import React from "react";
import { dateGranularity, ExplorationDateRange } from "shared/validators";
import {
  calculateProductAnalyticsDateRange,
  getDateGranularity,
} from "shared/enterprise";
import { Flex } from "@radix-ui/themes";
import { Select, SelectItem } from "@/ui/Select";
import { useExplorerContext } from "@/enterprise/components/ProductAnalytics/ExplorerContext";
import Badge from "@/ui/Badge";
import Text from "@/ui/Text";
import { getValidDateGranularities } from "@/enterprise/components/ProductAnalytics/util";

const dateGranularityLabels: Record<(typeof dateGranularity)[number], string> =
  {
    auto: "Auto",
    hour: "By Hour",
    day: "By Day",
    week: "By Week",
    month: "By Month",
    year: "By Year",
  };

export function ControlledGranularitySelector({
  dateRange,
  granularity,
  onChange,
  disabled,
  width,
}: {
  dateRange: ExplorationDateRange;
  granularity: (typeof dateGranularity)[number];
  onChange: (granularity: (typeof dateGranularity)[number]) => void;
  disabled?: boolean;
  width?: number;
}) {
  const resolvedDateRange = calculateProductAnalyticsDateRange(dateRange);
  const autoGranularity = getDateGranularity("auto", resolvedDateRange);
  const validGranularities = getValidDateGranularities(resolvedDateRange);
  const selectedGranularity = validGranularities.includes(granularity)
    ? granularity
    : "auto";

  return (
    <Select
      size="2"
      value={selectedGranularity}
      placeholder="Granularity"
      disabled={disabled}
      style={width ? { width } : undefined}
      setValue={(v) => onChange(v as (typeof dateGranularity)[number])}
    >
      {validGranularities.map((g) => (
        <SelectItem key={g} value={g}>
          {g === "auto" ? (
            <Flex
              direction="row"
              align="center"
              gap="2"
              style={{ whiteSpace: "nowrap" }}
            >
              <Text>{dateGranularityLabels[autoGranularity]}</Text>
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

export default function GranularitySelector() {
  const { draftExploreState, setDraftExploreState } = useExplorerContext();

  const dateDimension = draftExploreState.dimensions.find(
    (d) => d.dimensionType === "date",
  );
  const granularity = dateDimension?.dateGranularity || "auto";

  return (
    <ControlledGranularitySelector
      dateRange={draftExploreState.dateRange}
      granularity={granularity}
      onChange={(v) => {
        setDraftExploreState((prev) => ({
          ...prev,
          dimensions: prev.dimensions.map((d) =>
            d.dimensionType === "date"
              ? {
                  ...d,
                  dateGranularity: v,
                }
              : d,
          ),
        }));
      }}
    />
  );
}
