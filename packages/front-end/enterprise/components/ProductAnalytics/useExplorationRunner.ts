import { useCallback, useEffect, useRef } from "react";
import type { ProductAnalyticsExploration } from "shared/validators";
import type { QueryInterface } from "shared/types/query";
import { useExploreData } from "@/enterprise/components/ProductAnalytics/useExploreData";
import { explorationPollDelayMs } from "@/enterprise/components/ProductAnalytics/util";

export type ExplorationPoll = {
  data: ProductAnalyticsExploration | null;
  query: QueryInterface | null;
  error: string | null;
};

const isRunning = (p: ExplorationPoll | null) =>
  !!p && !p.error && p.data?.status === "running" && !!p.data.id;

// The one run-and-poll lifecycle for explorations. Each begin() replaces the
// previous run: its pending poll stops, and only the newest run's results are
// reported. The poll timer also stops on unmount.
export default function useExplorationRunner() {
  const { fetchExplorationById } = useExploreData();
  const generation = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancel = useCallback(() => {
    generation.current += 1;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  useEffect(() => cancel, [cancel]);

  const begin = useCallback(() => {
    cancel();
    const run = generation.current;
    const isCurrent = () => run === generation.current;

    // Polls every running exploration until all finish or time runs out.
    // Resolves null if a newer run replaces this one.
    const pollUntilDone = (
      initial: (ExplorationPoll | null)[],
      startTime: number,
    ) =>
      new Promise<{
        results: (ExplorationPoll | null)[];
        timedOut: boolean;
      } | null>((resolve) => {
        let latest = initial;
        const poll = async () => {
          timer.current = null;
          if (!isCurrent()) return resolve(null);
          latest = await Promise.all(
            latest.map((p) =>
              p && isRunning(p) && p.data?.id
                ? fetchExplorationById(p.data.id)
                : Promise.resolve(p),
            ),
          );
          if (!isCurrent()) return resolve(null);
          if (!latest.some(isRunning)) {
            return resolve({ results: latest, timedOut: false });
          }
          const delay = explorationPollDelayMs(
            Math.floor((Date.now() - startTime) / 1000),
          );
          if (delay <= 0) return resolve({ results: latest, timedOut: true });
          timer.current = setTimeout(poll, delay);
        };
        timer.current = setTimeout(poll, explorationPollDelayMs(0));
      });

    return { isCurrent, pollUntilDone };
  }, [cancel, fetchExplorationById]);

  return { begin, cancel };
}
