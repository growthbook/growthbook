import { useCallback, useEffect, useRef, useState } from "react";
import { buildComparisonExplorationConfig } from "shared/enterprise";
import {
  ComparisonMode,
  ExplorationConfig,
  ExplorationDateRange,
  ProductAnalyticsExploration,
} from "shared/validators";
import { QueryInterface } from "shared/types/query";
import { useAuth } from "@/services/auth";
import { useExploreData } from "@/enterprise/components/ProductAnalytics/useExploreData";
import useExplorationRunner, {
  ExplorationPoll,
  isRunning,
} from "@/enterprise/components/ProductAnalytics/useExplorationRunner";

const STILL_RUNNING =
  "This block's query is still running. Check back in a few minutes.";

export type TileResult = {
  exploration: ProductAnalyticsExploration;
  query: QueryInterface | null;
  comparison: ProductAnalyticsExploration | null;
  // Set when the comparison failed but the primary result came back
  comparisonError: string | null;
};

type TileState =
  | { status: "loading" }
  | { status: "miss" }
  | { status: "error"; error: string }
  | { status: "ready"; result: TileResult };

export type TileRequest = {
  config: ExplorationConfig | null;
  previousTimeFrame: ExplorationDateRange | null;
  comparisonMode: ComparisonMode;
  // The block's stored result ids, when it was saved with one
  stored: string | null;
  storedComparison: string | null;
  // Whether a block with no stored result starts from a cached one
  readCache: boolean;
};

type Loaded = { primary: ExplorationPoll; comparison: ExplorationPoll | null };

const noResult: ExplorationPoll = { data: null, query: null, error: null };

export function useTileResult(request: TileRequest) {
  const { apiCall } = useAuth();
  const { fetchData, fetchExplorationById } = useExploreData();
  const { begin } = useExplorationRunner();
  // The functions change whenever the sign-in token refreshes, and that
  // shouldn't reload the tile, so loads read everything through a ref.
  const latest = useRef({
    request,
    apiCall,
    fetchData,
    fetchExplorationById,
    begin,
  });
  latest.current = { request, apiCall, fetchData, fetchExplorationById, begin };

  const [state, setState] = useState<TileState>({ status: "loading" });

  const settle = useCallback(
    async (load: () => Promise<Loaded>, isUpdate: boolean) => {
      // Only the newest load or Update may commit, so a slower, older
      // response can't overwrite a newer one.
      const run = latest.current.begin();
      // An Update keeps the current chart up while it runs; the button shows
      // it's busy. A new config clears it, since it no longer matches.
      setState((current) =>
        isUpdate && current.status === "ready"
          ? current
          : { status: "loading" },
      );
      const fail = (error: string) => setState({ status: "error", error });
      const commit = ({ primary, comparison }: Loaded) => {
        if (!primary.data) {
          if (primary.error) fail(primary.error);
          else setState({ status: "miss" });
          return;
        }
        setState({
          status: "ready",
          result: {
            exploration: primary.data,
            query: primary.query,
            // A comparison that fails or times out leaves the primary up
            comparison: comparison?.error ? null : (comparison?.data ?? null),
            comparisonError: comparison?.error ?? null,
          },
        });
      };

      let loaded: Loaded;
      try {
        loaded = await load();
      } catch (e) {
        if (run.isCurrent()) fail(e instanceof Error ? e.message : String(e));
        return;
      }
      if (!run.isCurrent()) return;
      if (isRunning(loaded.primary) || isRunning(loaded.comparison)) {
        // A run that outlasts the server's wait comes back "running". An
        // Update leaves the current chart up until it finishes.
        if (!isUpdate) commit(loaded);
        const runStarted = loaded.primary.data?.runStarted;
        const outcome = await run.pollUntilDone(
          [loaded.primary, loaded.comparison],
          runStarted ? new Date(runStarted).getTime() : Date.now(),
        );
        if (!outcome) return;
        const [primary, comparison] = outcome.results;
        loaded = { primary: primary ?? loaded.primary, comparison };
        if (outcome.timedOut) {
          if (isRunning(loaded.primary)) return fail(STILL_RUNNING);
          loaded.comparison = { ...noResult, error: STILL_RUNNING };
        }
      }
      commit(loaded);
    },
    [],
  );

  // Callers rebuild an equal request every render, so the load keys on its
  // JSON. A stored result doesn't depend on the config, so editing it doesn't
  // reload one.
  const key = JSON.stringify(
    request.stored || !request.readCache
      ? [request.stored, request.storedComparison]
      : request,
  );

  useEffect(() => {
    const { request, apiCall, fetchExplorationById } = latest.current;
    const readCached = (config: ExplorationConfig) =>
      apiCall<{
        exploration: ProductAnalyticsExploration | null;
        query: QueryInterface | null;
      }>("/product-analytics/cached", {
        method: "POST",
        body: JSON.stringify({ config }),
      }).then(({ exploration, query }) => ({
        data: exploration,
        query,
        error: null,
      }));
    settle(async () => {
      const { stored, storedComparison, config, previousTimeFrame } = request;
      if (stored) {
        const [primary, comparison] = await Promise.all([
          fetchExplorationById(stored),
          storedComparison ? fetchExplorationById(storedComparison) : null,
        ]);
        return { primary, comparison };
      }
      // A block that was never saved starts from the cache, which only needs
      // read access.
      if (!request.readCache || !config) {
        return { primary: noResult, comparison: null };
      }
      const [primary, comparison] = await Promise.all([
        readCached(config),
        previousTimeFrame
          ? readCached(
              buildComparisonExplorationConfig(config, previousTimeFrame),
            ).catch((e: Error) => ({ ...noResult, error: e.message }))
          : null,
      ]);
      return { primary, comparison };
    }, false);
  }, [key, settle]);

  const run = useCallback(() => {
    const { request, fetchData } = latest.current;
    const { config, previousTimeFrame, comparisonMode } = request;
    if (!config) return;
    return settle(async () => {
      // Never the cache: Update is how a viewer gets newer data
      const result = await fetchData(config, {
        cache: "never",
        previousTimeFrame,
        comparisonMode: previousTimeFrame ? comparisonMode : null,
      });
      return {
        primary: {
          data: result.data,
          query: result.query,
          error: result.data
            ? null
            : (result.error ?? "This block's query failed."),
        },
        comparison: result.comparison && {
          data: result.comparison.exploration,
          query: null,
          error: result.comparison.error ?? null,
        },
      };
    }, true);
  }, [settle]);

  return { state, run };
}
