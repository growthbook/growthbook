import useSWR, { SWRConfiguration } from "swr";
import { useAuth } from "@/services/auth";

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

  // Scope the api request to the current organization
  const key = orgScoped ? orgId + "::" + path : path;

  const allowed = shouldRun ? shouldRun() : true;

  const config: SWRConfiguration = {};

  if (!autoRevalidate) {
    config.revalidateOnFocus = false;
    config.revalidateOnReconnect = false;
  }

  if (refreshInterval !== undefined) {
    config.refreshInterval = refreshInterval;
  }

  return useSWR<Response, Error>(
    allowed ? key : null,
    async () => apiCall<Response>(path, { method: "GET" }),
    config,
  );
}
