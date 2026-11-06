import { ReactNode } from "react";
import { Box, Flex } from "@radix-ui/themes";
import Text from "@/ui/Text";

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
}: {
  label: string;
  children: ReactNode;
  mb?: "0" | "3" | "4";
}) {
  return (
    <Flex align="baseline" gap="3" mb={mb}>
      <Box flexShrink="0" width={`${LABEL_WIDTH}px`}>
        <RuleLabel>{label}</RuleLabel>
      </Box>
      <Box flexGrow="1" minWidth="0">
        {children}
      </Box>
    </Flex>
  );
}
