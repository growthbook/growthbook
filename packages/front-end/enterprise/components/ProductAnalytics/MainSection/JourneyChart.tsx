import { Fragment, useCallback, useMemo, useState } from "react";
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
import { PiArrowRight, PiX } from "react-icons/pi";
import { useRouter } from "next/router";
import { encodeExplorationConfig } from "shared/enterprise";
import Button from "@/ui/Button";
import {
  journeyToFunnel,
  selectedJourneySteps,
} from "@/enterprise/components/ProductAnalytics/journeyFunnel";
import Badge from "@/ui/Badge";
import Frame from "@/ui/Frame";
import TextUI from "@/ui/Text";
import { useExplorerContext } from "@/enterprise/components/ProductAnalytics/ExplorerContext";
import LegendSwatchButton from "@/enterprise/components/ProductAnalytics/LegendSwatchButton";
import JourneySankey, { dimColor } from "./JourneySankey";
import {
  buildJourneyViewModel,
  withHiddenJourneyDims,
} from "./useJourneyModel";

const EMPTY_ROWS: ProductAnalyticsResultRow[] = [];

export default function JourneyChart({
  exploration,
  submittedExploreState,
}: {
  exploration: ProductAnalyticsExploration | null;
  submittedExploreState: ExplorationConfig;
}) {
  const router = useRouter();
  const {
    draftExploreState,
    clearJourneyAnchor,
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
  const hasDimension = submittedExploreState.dimensions.length > 0;
  const model = useMemo(() => {
    if (!dataset) return null;
    return buildJourneyViewModel({
      rows: exploration?.result?.rows ?? EMPTY_ROWS,
      dataset,
      hasDimension,
    });
  }, [dataset, exploration?.result?.rows, hasDimension]);
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

  const heightScale =
    draftDataset?.heightScale ?? dataset?.heightScale ?? "relative";

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
  if (process.env.NODE_ENV !== "production" && model.violations.length) {
    console.warn("[journeys] INVARIANT VIOLATIONS:", model.violations);
  }

  return (
    <Flex direction="column" style={{ flex: 1, minHeight: 0 }}>
      <Frame px="3" py="2" mt="3" mb="4">
        <Flex align="center" gap="2" wrap="wrap">
          <TextUI weight="medium">Current path</TextUI>
          {selectedJourneySteps(draftDataset ?? dataset).map(
            ({ label, index }, position) => (
              <Fragment key={index}>
                {position > 0 && <PiArrowRight aria-hidden="true" />}
                <Badge
                  title={label}
                  radius="full"
                  label={
                    <Flex align="center" gap="2">
                      <span>
                        {label.length > 30
                          ? `${label.slice(0, 12)}…${label.slice(-17)}`
                          : label}
                      </span>
                      <button
                        type="button"
                        aria-label={`Remove ${label} and ${(draftDataset ?? dataset).direction === "backward" ? "preceding" : "following"} steps`}
                        disabled={loading}
                        style={{
                          border: 0,
                          background: "transparent",
                          color: "inherit",
                          cursor: "pointer",
                          display: "flex",
                          padding: 2,
                        }}
                        onClick={() => {
                          if (index > 0) popJourneyPath(index - 1);
                          else clearJourneyAnchor();
                        }}
                      >
                        <PiX />
                      </button>
                    </Flex>
                  }
                />
              </Fragment>
            ),
          )}
          {(draftDataset ?? dataset).path.length > 0 && (
            <Box style={{ marginLeft: "auto", flexShrink: 0 }}>
              <Button
                size="sm"
                onClick={async () => {
                  const funnel = journeyToFunnel(
                    draftExploreState.type === "journey"
                      ? draftExploreState
                      : submittedExploreState,
                  );
                  await router.push(
                    `/product-analytics/explore/funnel?config=${encodeURIComponent(encodeExplorationConfig(funnel))}`,
                  );
                }}
              >
                Explore this funnel
              </Button>
            </Box>
          )}
        </Flex>
      </Frame>
      <Box style={{ flex: 1, minHeight: 220, position: "relative" }}>
        <JourneySankey
          model={visibleModel ?? model}
          heightScale={heightScale}
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
          {model.dimTop.concat([JOURNEY_OTHER]).map((d) => (
            <LegendSwatchButton
              key={d}
              color={dimColor(model.dimTop, d)}
              name={d}
              hidden={hiddenDims.has(d)}
              onClick={() => {
                setHiddenDims((prev) => {
                  const next = new Set(prev);
                  if (next.has(d)) next.delete(d);
                  else next.add(d);
                  return next;
                });
              }}
            />
          ))}
        </Flex>
      )}
    </Flex>
  );
}
