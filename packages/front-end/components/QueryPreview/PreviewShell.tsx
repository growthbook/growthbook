import { ReactNode } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiArrowClockwise } from "react-icons/pi";
import { ago, datetime } from "shared/dates";
import type { ProductAnalyticsExploration } from "shared/validators";
import LoadingSpinner from "@/components/LoadingSpinner";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Text from "@/ui/Text";
import Tooltip from "@/ui/Tooltip";
import PreviewEmptyState from "./PreviewEmptyState";
import styles from "./PreviewShell.module.scss";

function PreviewFooter({
  exploration,
  outdated,
  loading,
  disabled,
  onRun,
  onRefresh,
}: {
  exploration: ProductAnalyticsExploration | null;
  outdated: boolean;
  loading: boolean;
  disabled: boolean;
  onRun?: () => void;
  onRefresh?: () => void;
}) {
  return (
    <Box className={styles.footer}>
      {exploration && !outdated ? (
        // Once results are current, re-running is a quiet refresh.
        <Flex justify="end" align="center" gap="3">
          <Tooltip content={datetime(exploration.dateUpdated)}>
            <Text size="sm" color="text-mid">
              Updated {ago(exploration.dateUpdated)}
            </Text>
          </Tooltip>
          <Button
            variant="ghost"
            icon={<PiArrowClockwise />}
            disabled={loading || disabled}
            onClick={onRefresh}
          >
            {loading ? "Refreshing…" : "Refresh"}
          </Button>
        </Flex>
      ) : (
        <Flex justify="end">
          <Button disabled={loading || disabled} onClick={onRun}>
            Run query
          </Button>
        </Flex>
      )}
    </Box>
  );
}

// The frame around a 7-day preview chart: stale/error callouts, the controls
// row, the empty state, and the run/refresh footer. Purely presentational; the
// caller owns the query state.
export default function PreviewShell({
  complete,
  exploration,
  loading = false,
  error = null,
  outdated = false,
  disabled = false,
  onRun,
  onRefresh,
  controls,
  emptyDescription,
  incompleteDescription,
  renderChart,
}: {
  /** False while the definition is incomplete; only the footer is interactive. */
  complete: boolean;
  exploration: ProductAnalyticsExploration | null;
  loading?: boolean;
  error?: string | null;
  /** The shown result no longer matches the current definition. */
  outdated?: boolean;
  disabled?: boolean;
  onRun?: () => void;
  onRefresh?: () => void;
  /** Rendered in the header row, left of the date range note. */
  controls?: ReactNode;
  emptyDescription: string;
  /** Empty-state copy when incomplete. Defaults to `emptyDescription`. */
  incompleteDescription?: string;
  /** Called only when a result is available to render. */
  renderChart: (exploration: ProductAnalyticsExploration) => ReactNode;
}) {
  return (
    <Flex direction="column" gap="3" minHeight="0" aria-busy={loading}>
      {outdated && (
        <Callout status="warning" size="sm">
          {complete
            ? "Changes not applied. Run the query to refresh."
            : "Complete the definition, then run the query."}
        </Callout>
      )}
      {(complete || exploration) && (
        <Flex align="center" justify="between" gap="2" wrap="wrap">
          {controls}
          <Text size="sm" color="text-mid">
            Last 7 complete days (UTC)
          </Text>
        </Flex>
      )}
      {error && !loading ? (
        <Callout status="error">{error}</Callout>
      ) : loading && !exploration ? (
        <Flex p="4" align="center" justify="center">
          <LoadingSpinner />
        </Flex>
      ) : exploration ? (
        renderChart(exploration)
      ) : (
        <PreviewEmptyState
          description={
            complete
              ? emptyDescription
              : (incompleteDescription ?? emptyDescription)
          }
        />
      )}
      <PreviewFooter
        exploration={exploration}
        outdated={outdated}
        loading={loading}
        disabled={!complete || disabled}
        onRun={onRun}
        onRefresh={onRefresh}
      />
    </Flex>
  );
}
