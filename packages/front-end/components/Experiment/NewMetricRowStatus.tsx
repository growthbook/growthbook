import { Flex } from "@radix-ui/themes";
import type { NewMetricRowState } from "@/services/experiments";
import HelperText from "@/ui/HelperText";
import Link from "@/ui/Link";
import { Popover } from "@/ui/Popover";
import Text from "@/ui/Text";
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
            <span>Update failed</span>
            {state.error ? (
              <Popover
                side="bottom"
                align="start"
                trigger={<Link>Show error</Link>}
                contentStyle={{
                  maxWidth: 400,
                  maxHeight: 300,
                  overflowY: "auto",
                  padding: "12px 16px",
                }}
                content={
                  <Text size="md" overflowWrap="anywhere" whiteSpace="pre-wrap">
                    {state.error}
                  </Text>
                }
              />
            ) : null}
            {onViewQueries ? (
              <Link onClick={onViewQueries}>View queries</Link>
            ) : null}
          </Flex>
        </HelperText>
      );
  }
}
