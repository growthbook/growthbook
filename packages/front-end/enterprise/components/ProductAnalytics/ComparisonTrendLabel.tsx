import { Flex } from "@radix-ui/themes";
import { PiArrowDown, PiArrowUp } from "react-icons/pi";
import Text from "@/ui/Text";

type Props = {
  trend: { pctChange: number };
  priorValueScale?: number;
};

export default function ComparisonTrendLabel({
  trend,
  priorValueScale = 1,
}: Props) {
  const { pctChange } = trend;
  const pctDisplay = (Math.abs(pctChange) * 100).toFixed(1);
  const up = pctChange > 0;
  const flat = pctChange === 0;
  const iconScale = { transform: `scale(${priorValueScale})` };

  return (
    <Flex align="center" gap="1" mt="2">
      {!flat &&
        (up ? (
          <PiArrowUp style={iconScale} color="var(--green-9)" />
        ) : (
          <PiArrowDown style={iconScale} color="var(--red-9)" />
        ))}
      <Text size="inherit" color="text-mid" whiteSpace="nowrap">
        {flat
          ? "No change vs comparison"
          : `${pctChange >= 0 ? "+" : "−"}${pctDisplay}% vs comparison`}
      </Text>
    </Flex>
  );
}
