import { useCallback, useMemo } from "react";
import { Box, Flex } from "@radix-ui/themes";
import type {
  ExplorationConfig,
  JourneyDataset,
  ProductAnalyticsExploration,
  ProductAnalyticsResultRow,
} from "shared/validators";
import {
  JOURNEY_NONE,
  JOURNEY_OTHER,
  JOURNEY_TERMINALS,
  JOURNEY_OPTIONS_PER_STEP_INCREMENT,
  canIncreaseJourneyOptions,
  journeyDimValueCount,
  journeyOptionsAt,
  withJourneyOptionsAt,
} from "shared/journeys";
import TextUI from "@/ui/Text";
import { useExplorerContext } from "@/enterprise/components/ProductAnalytics/ExplorerContext";
import { journeyHistoryKey } from "@/enterprise/components/ProductAnalytics/journey-policy";
import JourneySankey, { dimColor } from "./JourneySankey";
import { useJourneyViewState } from "./useJourneyViewState";

const EMPTY_ROWS: ProductAnalyticsResultRow[] = [];

export default function JourneyChart({
  exploration,
  submittedExploreState,
}: {
  exploration: ProductAnalyticsExploration | null;
  submittedExploreState: ExplorationConfig;
  animate?: boolean;
}) {
  const {
    draftExploreState,
    setDraftExploreState,
    commitJourneyStep,
    popJourneyPath,
    loading,
  } = useExplorerContext();
  const dataset: JourneyDataset | null =
    draftExploreState.dataset?.type === "journey"
      ? draftExploreState.dataset
      : submittedExploreState.dataset.type === "journey"
        ? submittedExploreState.dataset
        : null;
  const rowPath = useMemo(() => {
    if (exploration?.config.dataset.type === "journey") {
      return exploration.config.dataset.path;
    }
    if (submittedExploreState.dataset.type === "journey") {
      return submittedExploreState.dataset.path;
    }
    return [];
  }, [exploration?.config.dataset, submittedExploreState.dataset]);
  const familyKey = JSON.stringify(journeyHistoryKey(submittedExploreState));
  const hasDimension = submittedExploreState.dimensions.length > 0;
  const viewState = useJourneyViewState({
    familyKey,
    rows: exploration?.result?.rows ?? EMPTY_ROWS,
    dataset,
    rowPath,
    hasDimension,
    frontierLoading: loading,
  });
  const model = viewState?.model ?? null;

  const onCommit = useCallback(
    (keys: string[]) => {
      for (const key of keys) {
        if (
          key === JOURNEY_OTHER ||
          JOURNEY_TERMINALS.has(key) ||
          key === JOURNEY_NONE
        ) {
          continue;
        }
        commitJourneyStep(key);
      }
    },
    [commitJourneyStep],
  );

  const dimValues = journeyDimValueCount(submittedExploreState.dimensions[0]);
  const canViewMore = useCallback(
    (levelIndex: number) => {
      if (!dataset) return false;
      return canIncreaseJourneyOptions({
        optionsPerStep: dataset.optionsPerStep,
        levelIndex,
        depth: dataset.depth,
        pathLength: dataset.path.length,
        dimValues,
      });
    },
    [dataset, dimValues],
  );
  const onViewMore = useCallback(
    (levelIndex: number) => {
      setDraftExploreState((prev) => {
        if (prev.dataset.type !== "journey") return prev;
        const nextValue =
          journeyOptionsAt(prev.dataset.optionsPerStep, levelIndex) +
          JOURNEY_OPTIONS_PER_STEP_INCREMENT;
        return {
          ...prev,
          dataset: {
            ...prev.dataset,
            optionsPerStep: withJourneyOptionsAt(
              prev.dataset.optionsPerStep,
              levelIndex,
              nextValue,
            ),
          },
        } as ExplorationConfig;
      });
    },
    [setDraftExploreState],
  );

  if (!dataset || !model) return null;

  if (model.emptyReason === "no-anchor") {
    return (
      <Flex p="4">
        <TextUI color="text-mid">
          No journeys contain that{" "}
          {dataset.direction === "backward" ? "ending" : "starting"} step under
          the current filters. Widen the date range or drop a filter.
        </TextUI>
      </Flex>
    );
  }
  if (model.emptyReason === "no-match") {
    return (
      <Flex p="4">
        <TextUI color="text-mid">No matching journeys.</TextUI>
      </Flex>
    );
  }

  if (process.env.NODE_ENV !== "production" && model.violations.length) {
    console.warn("[journeys] INVARIANT VIOLATIONS:", model.violations);
  }

  return (
    <Flex direction="column" style={{ flex: 1, minHeight: 0 }}>
      <Box style={{ flex: 1, minHeight: 220, position: "relative" }}>
        <JourneySankey
          model={model}
          scaleMode="perStep"
          onCommit={onCommit}
          onPop={popJourneyPath}
          onViewMore={onViewMore}
          canViewMore={canViewMore}
        />
      </Box>
      {hasDimension && (
        <Flex gap="4" px="3" pb="2" wrap="wrap">
          {model.dimTop.concat([JOURNEY_OTHER]).map((d) => (
            <Flex key={d} align="center" gap="2">
              <Box
                style={{
                  width: 11,
                  height: 11,
                  borderRadius: 3,
                  background: dimColor(model.dimTop, d),
                }}
              />
              <TextUI size="sm">{d}</TextUI>
            </Flex>
          ))}
        </Flex>
      )}
    </Flex>
  );
}
