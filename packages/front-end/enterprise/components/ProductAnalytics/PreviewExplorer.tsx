import { ReactNode, useEffect } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiArrowClockwise } from "react-icons/pi";
import { ago, datetime } from "shared/dates";
import { DEFAULT_EXPLORE_STATE } from "shared/enterprise";
import type {
  ExplorationConfig,
  ProductAnalyticsExploration,
} from "shared/validators";
import LoadingSpinner from "@/components/LoadingSpinner";
import PreviewEmptyState from "@/components/QueryPreview/PreviewEmptyState";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Text from "@/ui/Text";
import Tooltip from "@/ui/Tooltip";
import { ExplorerProvider, useExplorerContext } from "./ExplorerContext";
import styles from "./PreviewExplorer.module.scss";

const EMPTY_CONFIG: ExplorationConfig = {
  ...DEFAULT_EXPLORE_STATE,
  type: "metric",
  dataset: { type: "metric", values: [] },
};

type PreviewExplorerProps = {
  /** Null while the definition is incomplete; only the footer is interactive. */
  config: ExplorationConfig | null;
  trackingSource: string;
  /** Rendered in the header row, left of the date range note. */
  controls?: ReactNode;
  emptyDescription: string;
  /** Empty-state copy when `config` is null. Defaults to `emptyDescription`. */
  incompleteDescription?: string;
  warehouseUnavailableText: string;
  /** Called only when a result is available to render. */
  renderChart: (state: {
    exploration: ProductAnalyticsExploration;
    submittedExploreState: ExplorationConfig;
  }) => ReactNode;
};

// A passive 7-day preview: runs `config` through the explorer and frames the
// result with stale/error callouts, the controls row, the empty state, and the
// run/refresh footer.
export default function PreviewExplorer(props: PreviewExplorerProps) {
  return (
    <ExplorerProvider
      mode="passive-preview"
      initialConfig={props.config ?? EMPTY_CONFIG}
      queryEnabled={props.config !== null}
      trackingSource={props.trackingSource}
    >
      <PreviewBody {...props} />
    </ExplorerProvider>
  );
}

function PreviewBody({
  config,
  controls,
  emptyDescription,
  incompleteDescription,
  warehouseUnavailableText,
  renderChart,
}: PreviewExplorerProps) {
  const {
    exploration,
    submittedExploreState,
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
  const disabled = loading || !config || !isSubmittable;

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
      {error && !loading ? (
        <Callout status="error">{error}</Callout>
      ) : loading && !exploration ? (
        <Flex p="4" align="center" justify="center">
          <LoadingSpinner />
        </Flex>
      ) : exploration ? (
        renderChart({
          exploration,
          // Label the result with the config that produced it, never the draft.
          submittedExploreState: submittedExploreState ?? exploration.config,
        })
      ) : (
        <PreviewEmptyState
          description={
            config
              ? emptyDescription
              : (incompleteDescription ?? emptyDescription)
          }
        />
      )}
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
              disabled={disabled}
              onClick={() => handleSubmit({ force: true })}
            >
              {loading ? "Refreshing…" : "Refresh"}
            </Button>
          </Flex>
        ) : (
          <Flex justify="end">
            <Button disabled={disabled} onClick={() => handleSubmit()}>
              Run query
            </Button>
          </Flex>
        )}
      </Box>
    </Flex>
  );
}
