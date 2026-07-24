import { useEffect, useRef } from "react";
import useSWR, { SWRConfiguration } from "swr";
import { useAuth } from "@/services/auth";
import { useBackgroundRefreshError } from "@/services/BackgroundRefreshError";

export interface UseApiOptions<Response = unknown> {
  autoRevalidate?: boolean;
  shouldRun?: () => boolean;
  orgScoped?: boolean;
  // Number of ms between background refreshes, or a function of the latest
  // data returning the next interval (0 disables it). SWR supports both.
  refreshInterval?: number | ((latestData: Response | undefined) => number);
}

export default function useApi<Response = unknown>(
  path: string,
  {
    shouldRun,
    autoRevalidate = true,
    orgScoped = true,
    refreshInterval,
  }: UseApiOptions<Response> = {},
) {
  const { apiCall, orgId } = useAuth();
  const backgroundRefreshError = useBackgroundRefreshError();

  // Scope the api request to the current organization
  const key = orgScoped ? orgId + "::" + path : path;

  const allowed = shouldRun ? shouldRun() : true;
  const activeKey = allowed ? key : null;

  const config: SWRConfiguration = {};

  if (!autoRevalidate) {
    config.revalidateOnFocus = false;
    config.revalidateOnReconnect = false;
  }

  if (refreshInterval !== undefined) {
    config.refreshInterval = refreshInterval;
  }

  const swr = useSWR<Response, Error>(
    activeKey,
    async () => apiCall<Response>(path, { method: "GET" }),
    config,
  );

  // SWR keeps the last-good `data` when a background revalidation fails. If we
  // still have data, treat the failure as a *background* error: keep showing the
  // stale data (we suppress `error` below so call sites don't wipe the page) and
  // surface it unobtrusively via the global toast instead.
  const hasData = swr.data !== undefined;
  const refreshError = hasData ? swr.error : undefined;

  // The fetcher throws a *new* Error instance on every failed revalidation. Keep
  // the latest one in a ref and gate the effect on a stable boolean, so it only
  // runs when the *presence* of a background error toggles — not on every failed
  // fetch (which would otherwise churn report()/clear() and perpetually reset the
  // toast's debounce timer in the provider).
  const refreshErrorRef = useRef(refreshError);
  refreshErrorRef.current = refreshError;
  const hasRefreshError = refreshError !== undefined;

  useEffect(() => {
    if (!backgroundRefreshError || !activeKey) return;
    const err = refreshErrorRef.current;
    if (hasRefreshError && err) {
      backgroundRefreshError.report(activeKey, err);
    } else {
      backgroundRefreshError.clear(activeKey);
    }
    // Drop this key on unmount / key change (e.g. org switch) so a navigated-away
    // component can't keep the toast alive.
    return () => backgroundRefreshError.clear(activeKey);
  }, [backgroundRefreshError, activeKey, hasRefreshError]);

  return {
    data: swr.data,
    // Only surface `error` on initial load (no data yet). Once we have data, a
    // failed background revalidation is reported as `refreshError` instead, so
    // the call site keeps rendering the stale content.
    error: hasData ? undefined : swr.error,
    refreshError,
    // Forwarded lazily to preserve SWR's per-field render subscriptions — a
    // consumer that never reads these won't re-render when they change.
    get isValidating() {
      return swr.isValidating;
    },
    get isLoading() {
      return swr.isLoading;
    },
    mutate: swr.mutate,
  };
}
