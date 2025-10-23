import useSWR, { SWRConfiguration } from "swr";
import { useAuth } from "@/services/auth";

export interface UseApiOptions {
  autoRevalidate?: boolean;
  shouldRun?: () => boolean;
  orgScoped?: boolean;
}

export default function useApi<Response = unknown>(
  path: string,
  { shouldRun, autoRevalidate = true, orgScoped = true }: UseApiOptions = {},
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

  return useSWR<Response, Error>(
    allowed ? key : null,
    async () => apiCall<Response>(path, { method: "GET" }),
    config,
  );
}
