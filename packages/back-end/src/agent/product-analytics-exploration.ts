import { setTimeout as delay } from "timers/promises";
import type {
  DispatchInput,
  DispatchResult,
} from "back-end/src/agent/dispatcher";

const EXPLORATION_PATH_RE =
  /^\/api\/v1\/product-analytics\/(metric|fact-table|data-source|funnel)-exploration\/?$/;

const DEFAULT_POLL_TIMEOUT_MS = 10 * 60 * 1000;

type ExplorationRecord = {
  id?: unknown;
  status?: unknown;
};

type PollOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
  now?: () => number;
  wait?: (ms: number, signal?: AbortSignal) => Promise<void>;
};

function normalizePath(rawPath: string): string {
  const noQuery = rawPath.split("?")[0];
  if (noQuery.startsWith("/api/")) return noQuery;
  if (/^\/v\d+\//.test(noQuery)) return `/api${noQuery}`;
  if (noQuery.startsWith("/")) return `/api/v1${noQuery}`;
  return noQuery;
}

/** Recognizes the exploration POSTs that need agent-specific result handling. */
export function isProductAnalyticsExplorationRequest(
  input: Pick<DispatchInput, "method" | "path">,
): boolean {
  return (
    input.method === "POST" &&
    EXPLORATION_PATH_RE.test(normalizePath(input.path))
  );
}

function explorationFromResult(
  result: DispatchResult,
): ExplorationRecord | null {
  if (
    result.status < 200 ||
    result.status >= 300 ||
    !result.body ||
    typeof result.body !== "object" ||
    Array.isArray(result.body)
  ) {
    return null;
  }
  const exploration = (result.body as Record<string, unknown>).exploration;
  return exploration &&
    typeof exploration === "object" &&
    !Array.isArray(exploration)
    ? (exploration as ExplorationRecord)
    : null;
}

function explorationPollDelayMs(elapsedMs: number): number {
  if (elapsedMs < 10_000) return 2_000;
  if (elapsedMs < 30_000) return 3_000;
  if (elapsedMs < 60_000) return 5_000;
  if (elapsedMs < 300_000) return 10_000;
  return 20_000;
}

function mergePollResult(
  initialResult: DispatchResult,
  polledResult: DispatchResult,
): DispatchResult {
  if (
    !initialResult.body ||
    typeof initialResult.body !== "object" ||
    Array.isArray(initialResult.body) ||
    !polledResult.body ||
    typeof polledResult.body !== "object" ||
    Array.isArray(polledResult.body)
  ) {
    return polledResult;
  }
  return {
    status: polledResult.status,
    body: {
      ...initialResult.body,
      ...polledResult.body,
    },
  };
}

async function defaultWait(ms: number, signal?: AbortSignal): Promise<void> {
  await delay(ms, undefined, { signal, ref: false });
}

/**
 * Exploration handlers return after five seconds, so the agent continues
 * polling the stored model until the query reaches a terminal state.
 */
export async function pollProductAnalyticsExploration(
  initialResult: DispatchResult,
  getExploration: (id: string) => Promise<DispatchResult>,
  options: PollOptions = {},
): Promise<DispatchResult> {
  const initialExploration = explorationFromResult(initialResult);
  if (initialExploration?.status !== "running") return initialResult;

  const id =
    typeof initialExploration.id === "string" ? initialExploration.id : null;
  if (!id) return initialResult;

  const now = options.now ?? Date.now;
  const wait = options.wait ?? defaultWait;
  const timeoutMs = options.timeoutMs ?? DEFAULT_POLL_TIMEOUT_MS;
  const startedAt = now();
  let latest = initialResult;

  while (explorationFromResult(latest)?.status === "running") {
    const elapsedMs = now() - startedAt;
    if (elapsedMs >= timeoutMs) {
      const body =
        latest.body &&
        typeof latest.body === "object" &&
        !Array.isArray(latest.body)
          ? latest.body
          : {};
      return {
        status: latest.status,
        body: {
          ...body,
          message: `Product Analytics exploration ${id} is still running after the polling timeout.`,
          pollingTimedOut: true,
        },
      };
    }

    await wait(
      Math.min(explorationPollDelayMs(elapsedMs), timeoutMs - elapsedMs),
      options.signal,
    );
    const polled = await getExploration(id);
    if (polled.status < 200 || polled.status >= 300) return polled;
    latest = mergePollResult(initialResult, polled);
  }

  return latest;
}
