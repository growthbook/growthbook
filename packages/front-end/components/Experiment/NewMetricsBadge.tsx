import { PiInfo } from "react-icons/pi";
import { Flex } from "@radix-ui/themes";
import Badge from "@/ui/Badge";
import Text from "@/ui/Text";
import Tooltip from "@/ui/Tooltip";

export default function NewMetricsBadge({
  metricNames,
  resultsEndDate,
}: {
  metricNames: string[];
  resultsEndDate: string;
}) {
  return (
    <Tooltip
      content={
        <Flex direction="column" gap="2">
          <Text>Added since the last update: {metricNames.join(", ")}.</Text>
          <Text>
            Update new metrics computes only these, with data up to{" "}
            {resultsEndDate}, the end date of the current results.
          </Text>
          <Text>Update all metrics brings every metric up to now.</Text>
        </Flex>
      }
    >
      <Badge
        label={
          <>
            New metrics
            <PiInfo size={14} />
          </>
        }
        variant="soft"
        color="violet"
        radius="full"
      />
    </Tooltip>
  );
}
