import { ReactNode } from "react";
import { Box, Flex } from "@radix-ui/themes";
import Text from "@/ui/Text";
import { useFeaturePageRedesign } from "./FeaturePageRedesign";

// Wide enough for the longest label, so values share a left edge.
const LABEL_WIDTH = 104;

// How a rule's details are labeled.
function RuleLabel({ children }: { children: ReactNode }) {
  return <Text color="text-mid">{children}</Text>;
}

// A rule's detail as a label beside its value, as a details list reads.
export default function RuleField({
  label,
  children,
  mb = "3",
  align = "baseline",
}: {
  label: string;
  children: ReactNode;
  mb?: "0" | "3" | "4";
  // "start" where the value is a framed table, whose first line baseline
  // alignment can't find.
  align?: "baseline" | "start";
}) {
  const redesign = useFeaturePageRedesign();
  // The page it's tested against: an inline label leading the value, or above
  // a table, as main's were.
  if (!redesign) {
    return (
      <Flex
        direction={align === "start" ? "column" : "row"}
        align={align === "start" ? "stretch" : "baseline"}
        gap="2"
        mb={mb}
      >
        <Box flexShrink="0">
          <Text weight="medium">{label.toUpperCase()}</Text>
        </Box>
        <Box flexGrow="1" minWidth="0">
          {children}
        </Box>
      </Flex>
    );
  }
  return (
    // As tall as a row of badges, so rows step evenly whatever they hold.
    <Flex align={align} gap="3" mb={mb} minHeight="22px">
      {/* Centered in a row's height, where a top-aligned label sits too. */}
      <Flex
        flexShrink="0"
        width={`${LABEL_WIDTH}px`}
        minHeight="22px"
        align="center"
      >
        <RuleLabel>{label}</RuleLabel>
      </Flex>
      <Box flexGrow="1" minWidth="0">
        {children}
      </Box>
    </Flex>
  );
}
