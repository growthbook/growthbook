import { Flex } from "@radix-ui/themes";
import type { NewMetricRowState } from "@/services/experiments";
import HelperText from "@/ui/HelperText";
import Link from "@/ui/Link";
import Tooltip from "@/ui/Tooltip";
import LoadingSpinner from "@/components/LoadingSpinner";

// The metric name sits behind the expand-slices button's space (pl-3 + ml-2 in
// CompactResults), so the status starts at the same offset to line up with it.
const nameOffset = { ml: "5", mr: "2" } as const;

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
        <HelperText status="neutral" size="sm" {...nameOffset}>
          Not computed yet. This metric was added after the last update.
        </HelperText>
      );
    case "running":
      return (
        <HelperText
          status="neutral"
          size="sm"
          {...nameOffset}
          icon={<LoadingSpinner />}
        >
          Updating...
        </HelperText>
      );
    case "failed":
      return (
        <HelperText status="error" size="sm" {...nameOffset}>
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
