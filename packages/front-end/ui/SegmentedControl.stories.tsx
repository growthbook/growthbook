import { useState } from "react";
import { Box, Flex, Text } from "@radix-ui/themes";
import { LiaChartLineSolid } from "react-icons/lia";
import { TbChartAreaLineFilled } from "react-icons/tb";
import SegmentedControl from "./SegmentedControl";

export default function SegmentedControlStories() {
  const [view, setView] = useState<"day" | "week" | "month">("week");
  const [chart, setChart] = useState<"area" | "line">("area");
  const [mode, setMode] = useState<"means" | "probabilities" | "weights">(
    "means",
  );

  const viewOptions = [
    { value: "day" as const, label: "Day" },
    { value: "week" as const, label: "Week" },
    { value: "month" as const, label: "Month" },
  ];

  return (
    <Flex direction="column" gap="5">
      <Flex direction="column" gap="2">
        &rarr; Sizes
        <Flex align="center" gap="4">
          {(["sm", "md", "lg"] as const).map((size) => (
            <SegmentedControl
              key={size}
              size={size}
              aria-label={`View (${size})`}
              value={view}
              setValue={setView}
              options={viewOptions}
            />
          ))}
        </Flex>
      </Flex>
      <Flex direction="column" gap="2">
        &rarr; Icons
        <SegmentedControl
          aria-label="Chart type"
          value={chart}
          setValue={setChart}
          options={[
            {
              value: "area",
              ariaLabel: "Area",
              label: <TbChartAreaLineFilled size={18} />,
            },
            {
              value: "line",
              ariaLabel: "Line",
              label: <LiaChartLineSolid size={18} />,
            },
          ]}
        />
      </Flex>
      <Flex direction="column" gap="2">
        &rarr; Wrap: long labels take more lines in a narrow container
        <Box style={{ width: 280 }}>
          <SegmentedControl
            wrap
            aria-label="Chart"
            value={mode}
            setValue={setMode}
            options={[
              { value: "means", label: "Cumulative variation means" },
              { value: "probabilities", label: "Probability of winning" },
              { value: "weights", label: "Variation weights" },
            ]}
          />
        </Box>
        <Text size="1" color="gray">
          Without wrap, the control keeps its full width and overflows.
        </Text>
      </Flex>
    </Flex>
  );
}
