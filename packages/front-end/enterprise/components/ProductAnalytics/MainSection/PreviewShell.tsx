import { ReactNode, useEffect } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiArrowClockwise } from "react-icons/pi";
import { ago, datetime } from "shared/dates";
import type {
  ExplorationConfig,
  ProductAnalyticsExploration,
} from "shared/validators";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Text from "@/ui/Text";
import Tooltip from "@/ui/Tooltip";
import { useExplorerContext } from "@/enterprise/components/ProductAnalytics/ExplorerContext";
import PreviewEmptyState from "./PreviewEmptyState";
import styles from "./PreviewShell.module.scss";

/**
 * "panel": a narrow sticky side panel (metric editor). The footer is centered
 * and the run button spans the full width.
 * "page": a wide detail-page section (Population). The footer is right-aligned.
 */
export type PreviewLayout = "panel" | "page";

export function PreviewFooter({
  layout,
  exploration,
  outdated,
  loading,
  disabled,
  onRun,
  onRefresh,
}: {
  layout: PreviewLayout;
  exploration: ProductAnalyticsExploration | null;
  outdated: boolean;
  loading: boolean;
  disabled: boolean;
  onRun?: () => void;
  onRefresh?: () => void;
}) {
  const justify = layout === "panel" ? "center" : "end";
  return (
    <Box className={styles.footer}>
      {exploration && !outdated ? (
        // Once results are current, re-running is a quiet refresh.
        <Flex justify={justify} align="center" gap="3">
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
        <Flex justify={justify}>
          <Button
            style={layout === "panel" ? { width: "100%" } : undefined}
            disabled={loading || disabled}
            onClick={onRun}
          >
            Run query
          </Button>
        </Flex>
      )}
    </Box>
  );
}

// The frame around a 7-day preview chart: stale/error callouts, the controls
// row, the empty state, and the run/refresh footer. Must be rendered inside an
// ExplorerProvider.
export default function PreviewShell({
  config,
  layout,
  controls,
  emptyDescription,
  incompleteDescription,
  warehouseUnavailableText,
  renderChart,
}: {
  /** Null while the definition is incomplete; only the footer is interactive. */
  config: ExplorationConfig | null;
  layout: PreviewLayout;
  /** Rendered in the header row, left of the date range note. */
  controls?: ReactNode;
  emptyDescription: string;
  /** Empty-state copy when `config` is null. Defaults to `emptyDescription`. */
  incompleteDescription?: string;
  warehouseUnavailableText: string;
  /** Renders the chart, a spinner, or nothing for an error. */
  renderChart: (state: {
    exploration: ProductAnalyticsExploration | null;
    submittedExploreState: ExplorationConfig;
    loading: boolean;
    error: string | null;
  }) => ReactNode;
}) {
  const {
    exploration,
    submittedExploreState,
    draftExploreState,
    loading,
    error,
    isSubmittable,
    managedWarehouseUnavailable,
    handleSubmit,
    setDraftExploreState,
    isStale,
    needsFetch,
  } = useExplorerContext();
  useEffect(() => {
    if (config) setDraftExploreState(config);
  }, [config, setDraftExploreState]);
  const outdated = !!exploration && (!config || isStale || needsFetch);

  if (managedWarehouseUnavailable) {
    return <Text color="text-mid">{warehouseUnavailableText}</Text>;
  }

  return (
    <Flex direction="column" gap="3" minHeight="0" aria-busy={loading}>
      {outdated && (
        <Callout status="warning" size="sm">
          {config
            ? "Changes not applied. Run the query to refresh."
            : "Complete the definition, then run the query."}
        </Callout>
      )}
      {(config || exploration) && (
        <Flex align="center" justify="between" gap="2" wrap="wrap">
          {controls}
          <Text size="sm" color="text-mid">
            Last 7 complete days (UTC)
          </Text>
        </Flex>
      )}
      {exploration || loading ? (
        renderChart({
          exploration,
          submittedExploreState: submittedExploreState ?? draftExploreState,
          loading,
          error,
        })
      ) : error ? null : (
        <PreviewEmptyState
          description={
            config
              ? emptyDescription
              : (incompleteDescription ?? emptyDescription)
          }
        />
      )}
      {/* The chart renders nothing for an error, so show it here in place of
          the chart or empty state. */}
      {error && !loading && <Callout status="error">{error}</Callout>}
      <PreviewFooter
        layout={layout}
        exploration={exploration}
        outdated={outdated}
        loading={loading}
        disabled={!config || !isSubmittable}
        onRun={() => handleSubmit()}
        onRefresh={() => handleSubmit({ force: true })}
      />
    </Flex>
  );
}
