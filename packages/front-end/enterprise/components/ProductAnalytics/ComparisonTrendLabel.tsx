import { Flex } from "@radix-ui/themes";
import { PiCaretDown, PiCaretUp } from "react-icons/pi";
import type { ComparisonTrend } from "@/enterprise/components/ProductAnalytics/compareUtil";
import Text from "@/ui/Text";

function formatValue(value: number): string {
  if (Math.abs(value) >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(2)}M`;
  }
  if (Math.abs(value) >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export default function ComparisonTrendLabel({
  trend,
}: {
  trend: ComparisonTrend;
}) {
  if (trend.direction === "none") {
    return (
      <Text size="small" color="text-mid">
        {formatValue(trend.previous)}
      </Text>
    );
  }

  const percentColor =
    trend.direction === "up"
      ? "var(--green-11)"
      : trend.direction === "down"
        ? "var(--red-11)"
        : "var(--gray-11)";

  return (
    <Flex align="center" gap="1" wrap="wrap">
      <Text size="small" color="text-mid">
        ({formatValue(trend.previous)})
      </Text>
      {trend.direction === "up" ? (
        <PiCaretUp size={12} color="var(--green-11)" />
      ) : null}
      {trend.direction === "down" ? (
        <PiCaretDown size={12} color="var(--red-11)" />
      ) : null}
      {trend.percentChange ? (
        <span style={{ color: percentColor, fontSize: "var(--font-size-1)" }}>
          {trend.percentChange}
        </span>
      ) : null}
    </Flex>
  );
}
