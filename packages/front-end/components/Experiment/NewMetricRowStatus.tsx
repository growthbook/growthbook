import { Flex } from "@radix-ui/themes";
import { NewMetricRowState } from "@/services/experiments";
import HelperText from "@/ui/HelperText";
import Link from "@/ui/Link";
import Tooltip from "@/ui/Tooltip";
import LoadingSpinner from "@/components/LoadingSpinner";

export default function NewMetricRowStatus({
  state,
  onRefreshMetrics,
  onViewQueries,
}: {
  state: NewMetricRowState;
  onRefreshMetrics?: () => void;
  onViewQueries?: () => void;
}) {
  switch (state.status) {
    case "idle":
      return (
        <HelperText status="neutral" size="sm" mx="2">
          <Flex gap="2" wrap="wrap">
            Added after the last update
            {onRefreshMetrics ? (
              <Link onClick={onRefreshMetrics}>Update new metrics</Link>
            ) : null}
          </Flex>
        </HelperText>
      );
    case "running":
      return (
        <HelperText status="neutral" size="sm" mx="2" icon={<LoadingSpinner />}>
          Updating new metrics
        </HelperText>
      );
    case "failed":
      return (
        <HelperText status="error" size="sm" mx="2">
          <Flex gap="2" wrap="wrap">
            <Tooltip content={state.error} enabled={!!state.error}>
              <span>Update failed</span>
            </Tooltip>
            {onViewQueries ? (
              <Link onClick={onViewQueries}>View queries</Link>
            ) : null}
            {onRefreshMetrics ? (
              <Link onClick={onRefreshMetrics}>Try again</Link>
            ) : null}
          </Flex>
        </HelperText>
      );
    case "unavailable":
      return (
        <HelperText status="neutral" size="sm" mx="2">
          Added after the last update. Click Update to see its results.
        </HelperText>
      );
  }
}
