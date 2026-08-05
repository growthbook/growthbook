import { useEffect, useRef } from "react";
import useSWR, { SWRConfiguration } from "swr";
import { SESSION_EXPIRED_ERROR, useAuth } from "@/services/auth";
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

  // With data present, keep the stale data and surface the failure via the global toast.
  const hasData = swr.data !== undefined;
  const refreshError = hasData ? swr.error : undefined;

  // Session-expiry has its own auth toast; don't double-report it here.
  const reportableError =
    refreshError && refreshError.message !== SESSION_EXPIRED_ERROR
      ? refreshError
      : undefined;

  // Gate on a stable boolean (not per-failure Error identity) so the effect fires only when error presence toggles.
  const refreshErrorRef = useRef(reportableError);
  refreshErrorRef.current = reportableError;
  const hasRefreshError = reportableError !== undefined;

  useEffect(() => {
    if (!backgroundRefreshError || !activeKey) return;
    const err = refreshErrorRef.current;
    if (hasRefreshError && err) {
      backgroundRefreshError.report(activeKey, err);
    } else {
      backgroundRefreshError.clear(activeKey);
    }
    // Drop this key on unmount/key change so a navigated-away component can't keep the toast alive.
    return () => backgroundRefreshError.clear(activeKey);
  }, [backgroundRefreshError, activeKey, hasRefreshError]);

  return {
    data: swr.data,
    // Surface error only on initial load; background failures go to refreshError.
    error: hasData ? undefined : swr.error,
    refreshError,
    // Lazy getters preserve SWR's per-field render subscriptions.
    get isValidating() {
      return swr.isValidating;
    },
    get isLoading() {
      return swr.isLoading;
    },
    mutate: swr.mutate,
  };
}
