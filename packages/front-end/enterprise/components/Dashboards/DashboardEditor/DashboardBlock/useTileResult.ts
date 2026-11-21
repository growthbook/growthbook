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
import { explorationPollDelayMs } from "@/enterprise/components/ProductAnalytics/util";

// What GET /exploration/:id and POST /cached return
export type Loaded = {
  exploration: ProductAnalyticsExploration | null;
  query: QueryInterface | null;
};

// Poll interval for a tile's exploration: back off while it's still running,
// stop (0) once it's terminal (success/error) or absent.
export function pollDelayForExploration(
  exploration: ProductAnalyticsExploration | undefined | null,
): number {
  if (exploration?.status !== "running") return 0;
  const started = exploration.runStarted
    ? new Date(exploration.runStarted).getTime()
    : Date.now();
  return explorationPollDelayMs(Math.floor((Date.now() - started) / 1000));
}

// Re-reads a "running" result on a backoff until it finishes, or until a newer
// request takes over.
async function pollUntilDone(
  loaded: Loaded,
  read: (id: string) => Promise<Loaded>,
  isCurrent: () => boolean,
): Promise<Loaded> {
  let latest = loaded;
  while (latest.exploration?.status === "running" && isCurrent()) {
    const running = latest.exploration;
    await new Promise((resolve) =>
      setTimeout(resolve, pollDelayForExploration(running)),
    );
    if (!isCurrent()) break;
    latest = await read(running.id);
  }
  return latest;
}

export type TileResult = Loaded & {
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
  config: ExplorationConfig;
  previousTimeFrame: ExplorationDateRange | null;
  comparisonMode: ComparisonMode;
  // The block's stored result ids, when it was saved with one
  stored: string | null;
  storedComparison: string | null;
};

// Resolves a self-updating tile's one result: its stored result, or a cached
// one for a block that was never saved, until run() replaces it.
export function useTileResult(request: TileRequest) {
  const { apiCall } = useAuth();
  const { fetchData } = useExploreData();
  // Both change whenever the sign-in token refreshes, and that shouldn't
  // reload the tile, so requests read them through refs.
  const apiCallRef = useRef(apiCall);
  const fetchDataRef = useRef(fetchData);
  useEffect(() => {
    apiCallRef.current = apiCall;
    fetchDataRef.current = fetchData;
  }, [apiCall, fetchData]);

  const [state, setState] = useState<TileState>({ status: "loading" });
  // Each load and each Update takes the next number, and only the newest may
  // commit, so a slower, older response can't overwrite a newer one.
  const generation = useRef(0);

  const read = useCallback(
    (id: string) =>
      apiCallRef.current<Loaded>(`/product-analytics/exploration/${id}`),
    [],
  );

  const settle = useCallback(
    async (load: () => Promise<TileResult>, keepResult = false) => {
      const gen = ++generation.current;
      const isCurrent = () => gen === generation.current;
      // An Update keeps the current chart up while it runs; the button shows
      // it's busy. A new config clears it, since it no longer matches.
      setState((current) =>
        keepResult && current.status === "ready"
          ? current
          : { status: "loading" },
      );
      try {
        const result = await load();
        if (!isCurrent()) return;
        if (!result.exploration) {
          setState({ status: "miss" });
          return;
        }
        // A run that outlasts the server's wait comes back "running". An
        // Update leaves the current chart up until it finishes.
        if (!keepResult || result.exploration.status !== "running") {
          setState({ status: "ready", result });
        }
        const [primary, comparison] = await Promise.all([
          pollUntilDone(result, read, isCurrent),
          pollUntilDone(
            { exploration: result.comparison, query: null },
            read,
            isCurrent,
          ),
        ]);
        if (!isCurrent()) return;
        setState({
          status: "ready",
          result: { ...result, ...primary, comparison: comparison.exploration },
        });
      } catch (e) {
        if (!isCurrent()) return;
        setState({
          status: "error",
          error: e instanceof Error ? e.message : String(e),
        });
      }
    },
    [read],
  );

  // Callers rebuild an equal request every render, so effects key on its JSON
  const key = JSON.stringify(request);

  useEffect(() => {
    const request: TileRequest = JSON.parse(key);
    const readCached = (c: ExplorationConfig) =>
      apiCallRef.current<Loaded>("/product-analytics/cached", {
        method: "POST",
        body: JSON.stringify({ config: c }),
      });
    // A saved block starts from its stored result. One that was never saved
    // starts from the cache, which only needs read access.
    const readComparison = (timeFrame: ExplorationDateRange) =>
      request.stored
        ? request.storedComparison
          ? read(request.storedComparison)
          : Promise.resolve(null)
        : readCached(
            buildComparisonExplorationConfig(request.config, timeFrame),
          );
    settle(async () => {
      const [primary, comparison] = await Promise.all([
        request.stored ? read(request.stored) : readCached(request.config),
        request.previousTimeFrame
          ? readComparison(request.previousTimeFrame).then(
              (loaded) => ({
                exploration: loaded?.exploration ?? null,
                error: null,
              }),
              (e: Error) => ({ exploration: null, error: e.message }),
            )
          : null,
      ]);
      return {
        ...primary,
        comparison: comparison?.exploration ?? null,
        comparisonError: comparison?.error ?? null,
      };
    });
    const loads = generation;
    // A new key or unmounting retires this load
    return () => {
      loads.current++;
    };
  }, [key, read, settle]);

  const run = useCallback(() => {
    const request: TileRequest = JSON.parse(key);
    return settle(async () => {
      // Never the cache: Update is how a viewer gets newer data
      const result = await fetchDataRef.current(request.config, {
        cache: "never",
        previousTimeFrame: request.previousTimeFrame,
        comparisonMode: request.previousTimeFrame
          ? request.comparisonMode
          : null,
      });
      if (!result.data) {
        throw new Error(result.error ?? "This block's query failed.");
      }
      return {
        exploration: result.data,
        query: result.query,
        comparison: result.comparison?.exploration ?? null,
        comparisonError: result.comparison?.error ?? null,
      };
    }, true);
  }, [key, settle]);

  return { state, run };
}
