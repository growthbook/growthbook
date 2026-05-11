import type { ReactNode } from "react";
import { Flex } from "@radix-ui/themes";
import { PiArrowDown, PiArrowUp } from "react-icons/pi";
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

function PriorValueText({
  children,
  priorValueScale,
}: {
  children: ReactNode;
  priorValueScale?: number;
}) {
  if (priorValueScale !== undefined) {
    return (
      <span
        style={{
          fontSize: `${priorValueScale}em`,
          lineHeight: 1.1,
          color: "var(--gray-11)",
        }}
      >
        {children}
      </span>
    );
  }

  return (
    <Text size="small" color="text-mid">
      {children}
    </Text>
  );
}

export default function ComparisonTrendLabel({
  trend,
  priorValueScale,
}: {
  trend: ComparisonTrend;
  priorValueScale?: number;
}) {
  if (trend.direction === "none") {
    return (
      <PriorValueText priorValueScale={priorValueScale}>
        {formatValue(trend.previous)}
      </PriorValueText>
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
      <PriorValueText priorValueScale={priorValueScale}>
        ({formatValue(trend.previous)})
      </PriorValueText>
      {trend.direction === "up" ? (
        <PiArrowUp size={12} color="var(--green-11)" />
      ) : null}
      {trend.direction === "down" ? (
        <PiArrowDown size={12} color="var(--red-11)" />
      ) : null}
      {trend.percentChange ? (
        <span style={{ color: percentColor, fontSize: "var(--font-size-1)" }}>
          {trend.percentChange}
        </span>
      ) : null}
    </Flex>
  );
}
