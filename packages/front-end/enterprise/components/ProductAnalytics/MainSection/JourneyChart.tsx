import { useCallback, useMemo, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import type {
  ExplorationConfig,
  JourneyDataset,
  ProductAnalyticsExploration,
  ProductAnalyticsResultRow,
} from "shared/validators";
import { MAX_JOURNEY_PATH_LENGTH } from "shared/validators";
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
import { withHiddenJourneyDims } from "./useJourneyModel";
import { useJourneyViewState } from "./useJourneyViewState";

const EMPTY_ROWS: ProductAnalyticsResultRow[] = [];

export default function JourneyChart({
  exploration,
  submittedExploreState,
}: {
  exploration: ProductAnalyticsExploration | null;
  submittedExploreState: ExplorationConfig;
}) {
  const {
    draftExploreState,
    commitJourneyStep,
    popJourneyPath,
    loading,
    handleSubmit,
  } = useExplorerContext();
  const draftDataset =
    draftExploreState.dataset?.type === "journey"
      ? draftExploreState.dataset
      : null;
  const dataset: JourneyDataset | null =
    submittedExploreState.dataset.type === "journey"
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
  const [hiddenDims, setHiddenDims] = useState<Set<string>>(() => new Set());
  const visibleModel = useMemo(
    () => (model ? withHiddenJourneyDims(model, hiddenDims) : null),
    [model, hiddenDims],
  );

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
      if (!draftDataset) return false;
      return canIncreaseJourneyOptions({
        optionsPerStep: draftDataset.optionsPerStep,
        levelIndex,
        lookaheadDepth: draftDataset.lookaheadDepth,
        pathLength: draftDataset.path.length,
        dimValues,
      });
    },
    [draftDataset, dimValues],
  );
  const onViewMore = useCallback(
    (levelIndex: number) => {
      if (loading) return;
      if (draftExploreState.type !== "journey") return;
      const nextValue =
        journeyOptionsAt(draftExploreState.dataset.optionsPerStep, levelIndex) +
        JOURNEY_OPTIONS_PER_STEP_INCREMENT;
      void handleSubmit({
        setDraft: true,
        config: {
          ...draftExploreState,
          dataset: {
            ...draftExploreState.dataset,
            optionsPerStep: withJourneyOptionsAt(
              draftExploreState.dataset.optionsPerStep,
              levelIndex,
              nextValue,
            ),
          },
        },
      });
    },
    [draftExploreState, handleSubmit, loading],
  );
  const viewMoreLoading = useCallback(
    (levelIndex: number) => {
      if (!loading || !draftDataset) return false;
      const rowDataset =
        exploration?.config.dataset.type === "journey"
          ? exploration.config.dataset
          : submittedExploreState.dataset.type === "journey"
            ? submittedExploreState.dataset
            : null;
      if (!rowDataset) return true;
      return (
        journeyOptionsAt(draftDataset.optionsPerStep, levelIndex) >
        journeyOptionsAt(rowDataset.optionsPerStep, levelIndex)
      );
    },
    [draftDataset, exploration, loading, submittedExploreState.dataset],
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
          model={visibleModel ?? model}
          onCommit={onCommit}
          onPop={popJourneyPath}
          onViewMore={onViewMore}
          canViewMore={canViewMore}
          viewMoreLoading={viewMoreLoading}
          canCommitStep={
            (draftDataset?.path.length ?? dataset.path.length) <
            MAX_JOURNEY_PATH_LENGTH
          }
        />
      </Box>
      {hasDimension && (
        <Flex gap="4" px="3" pb="2" wrap="wrap">
          {model.dimTop.concat([JOURNEY_OTHER]).map((d) => {
            const hidden = hiddenDims.has(d);
            return (
              <button
                key={d}
                type="button"
                onClick={() => {
                  setHiddenDims((prev) => {
                    const next = new Set(prev);
                    if (next.has(d)) next.delete(d);
                    else next.add(d);
                    return next;
                  });
                }}
                aria-pressed={!hidden}
                aria-label={hidden ? `Show ${d}` : `Hide ${d}`}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  padding: 0,
                  border: "none",
                  background: "none",
                  cursor: "pointer",
                  opacity: hidden ? 0.45 : 1,
                }}
              >
                <Box
                  style={{
                    width: 11,
                    height: 11,
                    borderRadius: 3,
                    background: hidden
                      ? "var(--gray-a6)"
                      : dimColor(model.dimTop, d),
                  }}
                />
                <TextUI size="sm">{d}</TextUI>
              </button>
            );
          })}
        </Flex>
      )}
    </Flex>
  );
}
