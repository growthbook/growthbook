import { Flex } from "@radix-ui/themes";
import type { NewMetricRowState } from "@/services/experiments";
import HelperText from "@/ui/HelperText";
import Link from "@/ui/Link";
import Tooltip from "@/ui/Tooltip";
import LoadingSpinner from "@/components/LoadingSpinner";

export default function NewMetricRowStatus({
  state,
  onViewQueries,
}: {
  state: NewMetricRowState;
  onViewQueries?: () => void;
}) {
  switch (state.status) {
    case "notComputed":
      return (
        <HelperText status="neutral" size="sm" mx="2">
          Not computed yet. This metric was added after the last update.
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
          </Flex>
        </HelperText>
      );
  }
}
