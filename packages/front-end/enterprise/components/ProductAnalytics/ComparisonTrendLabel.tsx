import type { ReactNode } from "react";
import { Flex } from "@radix-ui/themes";
import { PiArrowDown, PiArrowUp } from "react-icons/pi";
import type { ComparisonTrend } from "@/enterprise/components/ProductAnalytics/compareUtil";
import { formatCompactNumber } from "@/enterprise/components/ProductAnalytics/util";
import Text from "@/ui/Text";

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
        {formatCompactNumber(trend.previous)}
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
