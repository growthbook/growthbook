import { Box, Flex } from "@radix-ui/themes";
import { PiInfo } from "react-icons/pi";
import Text from "@/ui/Text";
import Tooltip from "@/ui/Tooltip";

// Focusable so the description is reachable by keyboard and touch, not just
// on hover — it defines what the column or section it sits beside measures.
export default function AnalysisSettingInfo({
  ariaLabel,
  description,
  drilldownHint = false,
}: {
  ariaLabel: string;
  description: string;
  // Only the experiment results table supports clicking through to a drilldown.
  drilldownHint?: boolean;
}) {
  return (
    <Tooltip
      content={
        <Flex direction="column" gap="2" align="start">
          <Text as="p" size="sm">
            {description}
          </Text>
          {drilldownHint && (
            <Text as="p" size="sm">
              Click in the table to drill down and see the impact.
            </Text>
          )}
        </Flex>
      }
    >
      <Box as="span" display="inline-block" tabIndex={0} aria-label={ariaLabel}>
        <Text color="text-low">
          <PiInfo size={16} style={{ display: "block" }} aria-hidden />
        </Text>
      </Box>
    </Tooltip>
  );
}
